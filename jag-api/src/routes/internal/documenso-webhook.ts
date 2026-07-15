// Internal webhook — Documenso signing-completion receiver.
//
// Documenso POSTs here whenever a document's status changes (opened, signed,
// completed). We resolve the document back to whichever JAG record it belongs
// to (a lease Agreement or a handover condition-report checklist — both store
// documenso_document_id), pull the signed PDF, store it in MinIO, and update
// signature status.
//
// NOT under /api/v1/ and NOT behind Keycloak. Protected by DOCUMENSO_WEBHOOK_SECRET
// via the X-Documenso-Secret header (Documenso supports a proper per-webhook secret
// header, unlike DocuSeal's self-hosted webhook UI which only offered a plain URL
// field — no token-in-path workaround needed here).
// Configure in Documenso: Settings → Webhooks → URL = https://api.jagcorporate.com/internal/documenso-webhook,
// Secret = <DOCUMENSO_WEBHOOK_SECRET>, trigger = "document.completed" (confirmed via the
// live Webhooks UI trigger dropdown 2026-07-07 — lowercase dot notation, NOT the
// SCREAMING_SNAKE_CASE "DOCUMENT_COMPLETED" the prose docs implied).
//
// NOTE: payload shape (`{ event, data: { id, status, completedAt } }`) follows
// Documenso's documented webhook contract but hasn't been exercised against a
// real webhook delivery yet — verify on the first end-to-end signing test.

import { Router, type Request, type Response } from 'express';
import { timingSafeEqual } from 'crypto';
import { logger } from '../../lib/logger';
import { completeLeaseSigning, completeHandoverSigning } from '../../lib/documenso-completion';

export const documensoWebhookRouter = Router();

const WEBHOOK_SECRET = process.env['DOCUMENSO_WEBHOOK_SECRET'] ?? '';

interface DocumensoWebhookPayload {
  event?: string;
  data?: { id?: number | string; status?: string };
}

function secretMatches(provided: string): boolean {
  if (!WEBHOOK_SECRET) return true;
  const a = Buffer.from(provided);
  const b = Buffer.from(WEBHOOK_SECRET);
  return a.length === b.length && timingSafeEqual(a, b);
}

documensoWebhookRouter.post('/', (req: Request, res: Response): void => {
  const provided = req.header('X-Documenso-Secret') ?? '';
  if (!secretMatches(provided)) { res.status(401).end(); return; }

  // Always ack fast; do the lookup + PDF fetch fire-and-forget so Documenso's
  // webhook delivery is never blocked or retried by us.
  res.status(200).end();

  const payload = (req.body ?? {}) as DocumensoWebhookPayload;
  const eventType = payload.event ?? '';
  const documentId = String(payload.data?.id ?? '');
  if (!documentId) {
    // Previously a silent return — which masked a body-parser bug (Documenso's
    // ~400kb PDF-embedded payload exceeded express.json()'s 100kb limit, so
    // req.body arrived empty and every completed signature was dropped). Log it
    // so an empty/unparsed body is visible rather than looking like success.
    logger.warn({ entity: 'DOCUMENSO', action: 'WEBHOOK_EMPTY_BODY', event_type: eventType });
    return;
  }

  const isCompleted = eventType === 'document.completed' || payload.data?.status === 'COMPLETED';
  if (!isCompleted) {
    logger.info({ entity: 'DOCUMENSO', action: 'WEBHOOK_IGNORED', event_type: eventType, document_id: documentId });
    return;
  }

  // Fire-and-forget: completeLeaseSigning/completeHandoverSigning each check
  // Documenso's live status before writing anything, so this is safe even if
  // the event body claims completion prematurely. If the container is killed
  // mid-flight (a deploy landing in this exact window — see session 44), the
  // reconciliation sweep (lib/documenso-completion.ts reconcilePendingDocumensoSubmissions,
  // routes/internal/documenso-reconcile.ts) picks up any document left with no
  // stored signed PDF and finishes it on the next run.
  void (async () => {
    try {
      if (await completeLeaseSigning(documentId)) return;
      if (await completeHandoverSigning(documentId)) return;
      logger.warn({ entity: 'DOCUMENSO', action: 'WEBHOOK_NO_MATCH', document_id: documentId });
    } catch (e) {
      logger.warn({ entity: 'DOCUMENSO', action: 'WEBHOOK_HANDLE_FAILED', error: e instanceof Error ? e.message : String(e) });
    }
  })();
});
