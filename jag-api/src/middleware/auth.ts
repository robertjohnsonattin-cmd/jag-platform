import type { Request, Response, NextFunction } from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { JWTPayload } from 'jose';
import { corePool } from '../db/index';
import { logger } from '../lib/logger';
import { err } from '../lib/response';
import type { RLSContext } from './rls';

// Augment Express Request so route handlers can access req.rlsCtx without casting.
declare global {
  namespace Express {
    interface Request {
      rlsCtx: RLSContext;
    }
  }
}

interface KeycloakClaims extends JWTPayload {
  realm_access?: { roles: string[] };
  session_state?: string;
}

// Module-level singleton — createRemoteJWKSet caches public keys internally.
// Initialised on first request so missing env vars are caught at startup if
// getJwks() is called during app boot (e.g. health-check warm-up).
let jwksClient: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwksClient(): ReturnType<typeof createRemoteJWKSet> {
  if (!jwksClient) {
    const keycloakUrl = requireEnv('KEYCLOAK_URL');
    const realm = requireEnv('KEYCLOAK_REALM');
    const certsUrl = new URL(
      `${keycloakUrl}/realms/${realm}/protocol/openid-connect/certs`,
    );
    jwksClient = createRemoteJWKSet(certsUrl);
  }
  return jwksClient;
}

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

// Phase 1A: resolves keycloak_id → internal user.id, active tenant_id, and role name.
// One query joining users + user_tenant_roles + roles; returns the Owner role first
// when no tenant hint is supplied so that Robert's context is always preferred.
//
// Phase 1B: remove this function once custom Keycloak mappers add jag_user_id and
// jag_tenant_id to the JWT claims directly.
async function resolveUserFromKeycloakId(
  keycloakId: string,
  tenantHint: string | undefined,
): Promise<{ userId: string; tenantId: string; roleName: string }> {
  const client = await corePool.connect();
  let inTx = false;
  try {
    // Step 1: resolve keycloak_id → internal users.id via the users table (no RLS).
    const userResult = await client.query<{ id: string }>(
      `SELECT id FROM users WHERE keycloak_id = $1 AND is_active = true LIMIT 1`,
      [keycloakId],
    );
    if (userResult.rows.length === 0) {
      throw new UserNotProvisionedError();
    }
    const userId = userResult.rows[0].id;

    // Step 2: query user_tenant_roles using user_self_access RLS policy (migration 000007).
    // set_config(..., true) is the parameterised equivalent of SET LOCAL.
    await client.query('BEGIN');
    inTx = true;
    await client.query('SELECT set_config($1, $2, true)', ['app.current_user_id', userId]);

    let rows: Array<{ tenant_id: string; role_name: string }>;

    if (tenantHint) {
      const result = await client.query<{ tenant_id: string; role_name: string }>(
        `SELECT utr.tenant_id,
                r.name AS role_name
         FROM   user_tenant_roles utr
         JOIN   roles r ON r.id = utr.role_id
         WHERE  utr.user_id   = $1
           AND  utr.is_active  = true
           AND  utr.tenant_id  = $2
           AND  (utr.expires_at IS NULL OR utr.expires_at > now())
           AND  utr.revoked_at IS NULL
         LIMIT  1`,
        [userId, tenantHint],
      );
      rows = result.rows;
    } else {
      const result = await client.query<{ tenant_id: string; role_name: string }>(
        `SELECT utr.tenant_id,
                r.name AS role_name
         FROM   user_tenant_roles utr
         JOIN   roles r ON r.id = utr.role_id
         WHERE  utr.user_id   = $1
           AND  utr.is_active  = true
           AND  (utr.expires_at IS NULL OR utr.expires_at > now())
           AND  utr.revoked_at IS NULL
         ORDER BY (r.name = 'Owner') DESC, utr.created_at ASC
         LIMIT  1`,
        [userId],
      );
      rows = result.rows;
    }

    await client.query('COMMIT');
    inTx = false;

    if (rows.length === 0) {
      throw new UserNotProvisionedError();
    }

    return {
      userId,
      tenantId: rows[0].tenant_id,
      roleName: rows[0].role_name,
    };
  } catch (e) {
    if (inTx) { try { await client.query('ROLLBACK'); } catch { /* ignore */ } }
    throw e;
  } finally {
    client.release();
  }
}

class UserNotProvisionedError extends Error {
  constructor() { super('USER_NOT_PROVISIONED'); }
}

// Cache the Owner user so the auditor portal can inherit the correct ownerId.
// There is exactly one Owner per JAG deployment (Robert).
let ownerContextCache: { userId: string; tenantId: string; cachedAt: number } | null = null;
const OWNER_CACHE_TTL_MS = 300_000; // 5 min — stable value

async function resolveOwnerContext(): Promise<{ userId: string; tenantId: string }> {
  const now = Date.now();
  if (ownerContextCache && now - ownerContextCache.cachedAt < OWNER_CACHE_TTL_MS) {
    return ownerContextCache;
  }

  const client = await corePool.connect();
  try {
    // user_tenant_roles has RLS (user_self_access: user_id = app.current_user_id).
    // users table has no RLS — fetch all active user IDs first, then check each
    // one's roles under their own RLS context. Cached for 5 minutes so this
    // O(n-users) loop runs at most once per auditor login burst.
    const { rows: allUsers } = await client.query<{ id: string }>(
      `SELECT id FROM users WHERE is_active = true ORDER BY created_at ASC`,
    );

    for (const u of allUsers) {
      await client.query('BEGIN');
      await client.query('SELECT set_config($1, $2, true)', ['app.current_user_id', u.id]);
      const { rows } = await client.query<{ user_id: string; tenant_id: string }>(
        `SELECT utr.user_id, utr.tenant_id
         FROM   user_tenant_roles utr
         JOIN   roles r ON r.id = utr.role_id
         WHERE  r.name = 'Owner'
           AND  utr.user_id   = $1
           AND  utr.is_active = true
           AND  (utr.expires_at IS NULL OR utr.expires_at > now())
           AND  utr.revoked_at IS NULL
         LIMIT 1`,
        [u.id],
      );
      await client.query('COMMIT');
      if (rows.length > 0) {
        const { user_id: userId, tenant_id: tenantId } = rows[0];
        ownerContextCache = { userId, tenantId, cachedAt: now };
        return { userId, tenantId };
      }
    }
    throw new Error('Owner user not found in jag_core.');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    throw e;
  } finally {
    client.release();
  }
}

// Cache Brian's context so the DB is not hit on every X-Act-As request.
let brianContextCache: { userId: string; tenantId: string; cachedAt: number } | null = null;
const BRIAN_CACHE_TTL_MS = 60_000;

async function resolveBrianContext(): Promise<{ userId: string; tenantId: string }> {
  const now = Date.now();
  if (brianContextCache && now - brianContextCache.cachedAt < BRIAN_CACHE_TTL_MS) {
    return brianContextCache;
  }

  const client = await corePool.connect();
  try {
    const result = await client.query<{ brian_user_id: string; default_tenant_id: string }>(
      `SELECT brian_user_id, default_tenant_id FROM brian_portal_config LIMIT 1`,
    );
    if (result.rows.length === 0) throw new Error('Brian portal not configured.');
    const { brian_user_id, default_tenant_id: tenant_id } = result.rows[0];
    brianContextCache = { userId: brian_user_id, tenantId: tenant_id, cachedAt: now };
    return { userId: brian_user_id, tenantId: tenant_id };
  } finally {
    client.release();
  }
}

// Express middleware — verifies the Keycloak Bearer JWT, resolves the internal user
// record, and attaches RLSContext to req.rlsCtx for use by withTenantRLS / withOwnerRLS.
//
// Usage:
//   router.use(requireAuth());
//   router.get('/items', async (req, res) => {
//     const client = await commercialPool.connect();
//     try {
//       const rows = await withTenantRLS(client, req.rlsCtx, c => c.query('SELECT * FROM ims_items'));
//       res.json(rows.rows);
//     } finally { client.release(); }
//   });
//
// X-Tenant-ID header: optional. Provide when the authenticated user holds roles in
// multiple tenants and the client knows which tenant context is required for this call.
export function requireAuth() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      err(res, 401, 'MISSING_TOKEN', 'Authorization header with Bearer token is required.');
      return;
    }

    const token = authHeader.slice(7);

    try {
      const issuerUrl = process.env['KEYCLOAK_ISSUER_URL'] ?? requireEnv('KEYCLOAK_URL');
      const realm     = requireEnv('KEYCLOAK_REALM');

      const { payload } = await jwtVerify<KeycloakClaims>(token, getJwksClient(), {
        issuer: `${issuerUrl}/realms/${realm}`,
      });

      const keycloakSub = payload.sub;
      if (!keycloakSub) {
        err(res, 401, 'INVALID_TOKEN', 'Token is missing, expired, or invalid.');
        return;
      }

      const tenantHint  = req.headers['x-tenant-id'] as string | undefined;
      const actAsHeader = req.headers['x-act-as'] as string | undefined;

      const { userId, tenantId, roleName } = await resolveUserFromKeycloakId(
        keycloakSub,
        tenantHint,
      );

      const isOwner          = roleName === 'Owner';
      const realmRoles       = payload.realm_access?.roles ?? [];
      const isBrianPortal    = realmRoles.includes('brian_portal');
      const isAuditorPortal  = realmRoles.includes('jag_auditor');

      // X-Act-As: brian — Owner only. Substitutes Brian's user/owner context into RLS
      // so Robert can create, read, and update on Brian's behalf using existing endpoints.
      // Robert's userId is preserved as operatorId for audit trail purposes.
      if (actAsHeader?.toLowerCase() === 'brian' && isOwner) {
        const brianCtx = await resolveBrianContext();
        req.rlsCtx = {
          userId:     brianCtx.userId,
          tenantId:   brianCtx.tenantId,
          isOwner:    true,    // Robert's privilege carries — he can do anything Brian can
          ownerId:    brianCtx.userId,
          operatorId: userId,  // Robert's real ID — used in audit logs
        };
      } else if (isAuditorPortal && !isOwner) {
        // Auditor portal: read-only access to the Owner's books.
        // The auditor's own userId is preserved for audit logging, but the RLS
        // ownerId is set to the Owner's UUID so the auditor sees Robert's data.
        const ownerCtx = await resolveOwnerContext();
        req.rlsCtx = {
          userId,                    // auditor's own user ID — for audit trail
          tenantId: ownerCtx.tenantId,
          isOwner:  false,           // never elevate auditor to owner privilege
          ownerId:  ownerCtx.userId, // Owner's UUID — satisfies jag_family RLS policies
          isAuditorPortal: true,
        };
      } else {
        req.rlsCtx = {
          userId,
          tenantId,
          isOwner,
          ownerId:       userId,
          isBrianPortal: isBrianPortal || undefined,
        };
      }

      next();
    } catch (e) {
      if (e instanceof UserNotProvisionedError) {
        err(res, 403, 'USER_NOT_PROVISIONED', 'User account is not yet provisioned on this platform.');
        return;
      }
      logger.warn({ entity: 'AUTH', action: 'TOKEN_REJECTED', error_message: (e as Error).message });
      err(res, 401, 'INVALID_TOKEN', 'Token is missing, expired, or invalid.');
    }
  };
}
