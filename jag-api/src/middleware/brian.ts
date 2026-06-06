// Brian portal gate middleware.
//
// Add brianPortalGate('MODULE_NAME') to every router that Brian can potentially access.
// For non-Brian requests it is a no-op. For Brian's JWT it enforces the permission level
// stored in brian_module_permissions:
//
//   NONE  → 403
//   READ  → GET-only; POST/PATCH/DELETE → 403
//   WRITE → full access
//
// Robert using X-Act-As: brian bypasses this gate entirely — his isOwner flag is true
// and operatorId is set, so the gate passes through immediately.

import type { Request, Response, NextFunction } from 'express';
import { corePool } from '../db/index';
import { err } from '../lib/response';
import { logger } from '../lib/logger';

type AccessLevel = 'NONE' | 'READ' | 'WRITE';

// Simple in-process cache — avoids a DB round-trip on every Brian request.
const permissionsCache = new Map<string, { level: AccessLevel; cachedAt: number }>();
const CACHE_TTL_MS = 60_000;

async function getPermission(module: string): Promise<AccessLevel> {
  const cached = permissionsCache.get(module);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) return cached.level;

  const client = await corePool.connect();
  try {
    const result = await client.query<{ access_level: AccessLevel }>(
      `SELECT access_level FROM brian_module_permissions WHERE module = $1`, [module],
    );
    // Unknown module defaults to NONE — safe.
    const level: AccessLevel = result.rows[0]?.access_level ?? 'NONE';
    permissionsCache.set(module, { level, cachedAt: Date.now() });
    return level;
  } finally {
    client.release();
  }
}

// Call this whenever a permission is updated so the cache reflects immediately.
export function invalidateBrianPermissionCache(module?: string): void {
  if (module) permissionsCache.delete(module);
  else permissionsCache.clear();
}

export function brianPortalGate(module: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Not Brian's portal — pass through.
    if (!req.rlsCtx?.isBrianPortal) { next(); return; }

    try {
      const level = await getPermission(module);

      if (level === 'NONE') {
        logger.warn({ entity: 'BRIAN_PORTAL', action: 'ACCESS_DENIED', module, user_id: req.rlsCtx.userId });
        err(res, 403, 'ACCESS_DENIED', `You do not have access to the ${module} module.`);
        return;
      }

      if (level === 'READ' && req.method !== 'GET') {
        logger.warn({ entity: 'BRIAN_PORTAL', action: 'WRITE_DENIED', module, user_id: req.rlsCtx.userId });
        err(res, 403, 'READ_ONLY', `Your access to ${module} is read-only.`);
        return;
      }

      logger.info({ entity: 'BRIAN_PORTAL', action: 'ACCESS_GRANTED', module, level, user_id: req.rlsCtx.userId });
      next();
    } catch (e) {
      next(e);
    }
  };
}
