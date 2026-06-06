import { Router, type Request, type Response, type NextFunction } from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { JWTPayload } from 'jose';
import { z } from 'zod';
import { corePool } from '../db/index';
import { logger } from '../lib/logger';
import { ok, err } from '../lib/response';

const router = Router();

// ── JWKS client (module-level singleton) ──────────────────────────────────────

let jwksClient: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwksClient(): ReturnType<typeof createRemoteJWKSet> {
  if (!jwksClient) {
    const url = requireEnv('KEYCLOAK_URL');
    const realm = requireEnv('KEYCLOAK_REALM');
    jwksClient = createRemoteJWKSet(
      new URL(`${url}/realms/${realm}/protocol/openid-connect/certs`),
    );
  }
  return jwksClient;
}

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

// ── Zod schema ────────────────────────────────────────────────────────────────

// Body is optional — all user identity comes from the verified JWT.
// display_name override lets a client supply the user's preferred name on first
// login before Keycloak's profile has been enriched.
const SyncUserBodySchema = z.object({
  display_name: z.string().min(1).max(200).optional(),
}).strict();

// ── Keycloak Admin write-back ─────────────────────────────────────────────────

// Writes jag_user_id back to Keycloak as a user attribute so future tokens
// carry it as a JWT claim (see Phase 1B Section 1 — Custom Keycloak Mappers).
//
// Requires KEYCLOAK_ADMIN_CLIENT_ID + KEYCLOAK_ADMIN_CLIENT_SECRET (service
// account with manage-users realm role). These are Phase 1B blockers owned by
// Robert; failure here is logged but does NOT fail the sync request — the auth
// middleware DB-lookup fallback continues working until the attribute is present.
async function writeKeycloakUserAttribute(
  keycloakId: string,
  internalUserId: string,
): Promise<void> {
  const adminClientId = process.env['KEYCLOAK_ADMIN_CLIENT_ID'];
  const adminClientSecret = process.env['KEYCLOAK_ADMIN_CLIENT_SECRET'];

  if (!adminClientId || !adminClientSecret) {
    logger.warn({
      entity: 'AUTH',
      action: 'KC_ATTRIBUTE_WRITE_SKIPPED',
      error_message:
        'KEYCLOAK_ADMIN_CLIENT_ID / KEYCLOAK_ADMIN_CLIENT_SECRET not set — ' +
        'skipping jag_user_id attribute write-back (auth middleware DB fallback active)',
    });
    return;
  }

  const keycloakUrl = requireEnv('KEYCLOAK_URL');
  const realm = requireEnv('KEYCLOAK_REALM');

  // 1. Obtain admin access token via client_credentials grant.
  const tokenRes = await fetch(
    `${keycloakUrl}/realms/${realm}/protocol/openid-connect/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: adminClientId,
        client_secret: adminClientSecret,
      }),
    },
  );

  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    throw new Error(`Keycloak admin token request failed (${tokenRes.status}): ${body}`);
  }

  const { access_token: adminToken } = await tokenRes.json() as { access_token: string };

  // 2. GET current user representation to preserve existing attributes.
  const getUserRes = await fetch(
    `${keycloakUrl}/admin/realms/${realm}/users/${keycloakId}`,
    { headers: { Authorization: `Bearer ${adminToken}` } },
  );

  if (!getUserRes.ok) {
    throw new Error(`GET Keycloak user failed (${getUserRes.status})`);
  }

  const kcUser = await getUserRes.json() as {
    attributes?: Record<string, string[]>;
    [key: string]: unknown;
  };

  // 3. Merge jag_user_id into existing attributes and PUT back.
  const updatedAttributes = {
    ...(kcUser.attributes ?? {}),
    jag_user_id: [internalUserId],
  };

  const putRes = await fetch(
    `${keycloakUrl}/admin/realms/${realm}/users/${keycloakId}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...kcUser, attributes: updatedAttributes }),
    },
  );

  if (!putRes.ok) {
    const body = await putRes.text();
    throw new Error(`PUT Keycloak user failed (${putRes.status}): ${body}`);
  }
}

// ── POST /api/v1/auth/sync-user ───────────────────────────────────────────────
//
// Called by the frontend immediately after a successful Keycloak login to ensure
// a jag_core.users row exists and the jag_user_id Keycloak attribute is set.
//
// No requireAuth() middleware — that middleware would 403 if the user isn't yet
// provisioned.  This endpoint verifies the JWT itself and is idempotent.
//
// Returns:
//   201  — user row created for the first time
//   200  — user row already existed (idempotent re-call)

router.post('/sync-user', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // 1. Verify Bearer JWT.
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      err(res, 401, 'MISSING_TOKEN', 'Authorization header with Bearer token is required.');
      return;
    }

    const token = authHeader.slice(7);
    let payload: JWTPayload & {
      email?: string;
      name?: string;
      preferred_username?: string;
    };

    try {
      const issuerUrl = process.env['KEYCLOAK_ISSUER_URL'] ?? requireEnv('KEYCLOAK_URL');
      const realm = requireEnv('KEYCLOAK_REALM');
      const result = await jwtVerify(token, getJwksClient(), {
        issuer: `${issuerUrl}/realms/${realm}`,
      });
      payload = result.payload as typeof payload;
    } catch {
      err(res, 401, 'INVALID_TOKEN', 'Token is missing, expired, or invalid.');
      return;
    }

    const keycloakId = payload.sub;
    if (!keycloakId) {
      err(res, 401, 'INVALID_TOKEN', 'Token is missing, expired, or invalid.');
      return;
    }

    // 2. Validate optional request body.
    const parseResult = SyncUserBodySchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.');
      return;
    }

    const email = payload.email ?? '';
    if (!email) {
      err(res, 422, 'TOKEN_MISSING_EMAIL', 'Token does not contain an email claim.');
      return;
    }

    const displayName =
      parseResult.data.display_name ??
      payload.name ??
      payload.preferred_username ??
      email.split('@')[0];

    // 3. Upsert users row.
    const client = await corePool.connect();
    let internalUserId: string;
    let created: boolean;

    try {
      const result = await client.query<{ id: string; xmax: string }>(
        `INSERT INTO users (keycloak_id, email, display_name, last_login_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (keycloak_id) DO UPDATE
           SET email          = EXCLUDED.email,
               display_name   = EXCLUDED.display_name,
               last_login_at  = now(),
               updated_at     = now()
         RETURNING id, xmax::text`,
        [keycloakId, email, displayName],
      );

      const row = result.rows[0];
      internalUserId = row.id;
      // xmax = 0 means the row was inserted (not updated).
      created = row.xmax === '0';
    } finally {
      client.release();
    }

    logger.info({
      entity: 'AUTH',
      action: created ? 'USER_CREATED' : 'USER_SYNCED',
      user_id: internalUserId,
    });

    // 4. Write jag_user_id back to Keycloak (best-effort; never blocks the response).
    try {
      await writeKeycloakUserAttribute(keycloakId, internalUserId);
    } catch (writeErr) {
      logger.error({
        entity: 'AUTH',
        action: 'KC_ATTRIBUTE_WRITE_FAILED',
        user_id: internalUserId,
        error_code: 'KC_WRITE_BACK_ERROR',
        error_message: (writeErr as Error).message,
      });
      // Intentional: do not propagate — auth middleware DB fallback covers the gap.
    }

    ok(res, { user_id: internalUserId }, created ? 201 : 200);
  } catch (e) {
    next(e);
  }
});

export { router as authRouter };
