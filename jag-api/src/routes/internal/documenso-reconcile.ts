// Internal sweep — catches Documenso completions the webhook missed (e.g. an
// API redeploy landing in the fire-and-forget window between webhook receipt
// and background PDF-store completing; see lib/documenso-completion.ts for
// the full explanation and the session-44 incident that motivated this).
//
// NOT under /api/v1/ and NOT behind Keycloak. Docker-network-only, protected
// by a bearer token — same pattern as routes/internal/traccar-event.ts
// (TRACCAR_EVENT_TOKEN) and routes/internal/minio-audit.ts (MINIO_AUDIT_TOKEN).
// Called on a schedule by jag-infra/scripts/documenso-reconcile.sh (VM cron).
import { Router, type Request, type Response } from 'express';
import { timingSafeEqual } from 'crypto';
import { reconcilePendingDocumensoSubmissions } from '../../lib/documenso-completion';
import { logger } from '../../lib/logger';

export const documensoReconcileRouter = Router();

const TOKEN = process.env['DOCUMENSO_RECONCILE_TOKEN'] ?? '';

function tokenMatches(provided: string): boolean {
  if (!TOKEN) return false; // never allow an unauthenticated sweep, unlike the webhook's dev-mode passthrough
  const a = Buffer.from(provided);
  const b = Buffer.from(TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

documensoReconcileRouter.post('/', async (req: Request, res: Response): Promise<void> => {
  const auth = req.header('Authorization') ?? '';
  const provided = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!tokenMatches(provided)) { res.status(401).end(); return; }

  try {
    const result = await reconcilePendingDocumensoSubmissions();
    res.json({ success: true, data: result });
  } catch (e) {
    logger.warn({ entity: 'DOCUMENSO', action: 'RECONCILE_ENDPOINT_FAILED', error_message: e instanceof Error ? e.message : String(e) });
    res.status(500).json({ success: false, error: 'Reconciliation sweep failed.' });
  }
});
