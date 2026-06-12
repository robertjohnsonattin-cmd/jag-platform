import type { Request, Response, NextFunction } from 'express';
import { err } from '../lib/response';

// Owner-only gate — must be added to any destructive admin endpoint (hard delete, purge).
// Relies on isOwner resolved by requireAuth() from the Keycloak JWT + DB role lookup.
export function requireOwner() {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.rlsCtx.isOwner) {
      err(res, 403, 'FORBIDDEN', 'This action requires Owner role.');
      return;
    }
    next();
  };
}
