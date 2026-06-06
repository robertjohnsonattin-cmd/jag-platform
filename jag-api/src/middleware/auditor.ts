// Auditor portal gate middleware.
//
// Add auditorGate() to any router the accountant can access.
// For non-auditor requests it is a no-op. For auditor JWTs it enforces:
//
//   GET only — POST/PATCH/DELETE → 403 METHOD_NOT_ALLOWED
//
// The auditor's RLS context already carries the Owner's ownerId (set in auth.ts),
// so they see the right data. This middleware ensures they cannot modify anything.
//
// Robert's own requests (isOwner=true) bypass the gate entirely.

import type { Request, Response, NextFunction } from 'express';
import { err } from '../lib/response';
import { logger } from '../lib/logger';

// Routes the auditor may NOT access even via GET — export-only paths are fine,
// but raw admin or mutation-only endpoints should be excluded entirely.
const AUDITOR_BLOCKED_PREFIXES = [
  '/pending-review',  // internal ops queue, not for accountant view
];

export function auditorGate() {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Not an auditor request — pass through.
    if (!req.rlsCtx?.isAuditorPortal) { next(); return; }

    // Owner also passes through (Robert can do anything).
    if (req.rlsCtx.isOwner) { next(); return; }

    // Block non-GET methods.
    if (req.method !== 'GET') {
      logger.warn({
        entity: 'AUDITOR_PORTAL',
        action: 'WRITE_DENIED',
        method: req.method,
        path: req.path,
        user_id: req.rlsCtx.userId,
      });
      err(res, 403, 'READ_ONLY', 'Auditor access is read-only.');
      return;
    }

    // Block specific paths.
    const isBlocked = AUDITOR_BLOCKED_PREFIXES.some(prefix => req.path.startsWith(prefix));
    if (isBlocked) {
      logger.warn({
        entity: 'AUDITOR_PORTAL',
        action: 'PATH_BLOCKED',
        path: req.path,
        user_id: req.rlsCtx.userId,
      });
      err(res, 403, 'ACCESS_DENIED', 'This endpoint is not available to the auditor portal.');
      return;
    }

    logger.info({
      entity: 'AUDITOR_PORTAL',
      action: 'ACCESS_GRANTED',
      method: req.method,
      path: req.path,
      user_id: req.rlsCtx.userId,
    });
    next();
  };
}
