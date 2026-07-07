// Internal webhook — DocuSeal signing-completion receiver.
//
// DocuSeal POSTs here whenever a submission's status changes (viewed, one
// submitter completed, all submitters completed). We resolve the submission
// back to whichever JAG record it belongs to (a lease Agreement or a
// handover condition-report checklist — both store docuseal_submission_id),
// pull the signed PDF, store it in MinIO, and update signature status.
//
// NOT under /api/v1/ and NOT behind Keycloak. Protected by
// DOCUSEAL_WEBHOOK_TOKEN (shared secret, Authorization: Bearer ...). Only
// reachable from inside the Docker network (DocuSeal → jag-api).
//
// NOTE: event_type strings / payload shape follow DocuSeal's documented
// webhook contract but haven't been exercised against a live instance yet —
// verify against real payloads on the first end-to-end signing test.

import { Router, type Request, type Response } from 'express';
import { propertiesPool } from '../../db/index';
import { withOwnerRLS } from '../../middleware/rls';
import { logger } from '../../lib/logger';
import { getSubmission, downloadSignedPdf } from '../../lib/docuseal';
import { minioClient, ensureBucket, mediaObjectKey, BUCKET_SIGNED_DOCUMENTS } from '../../lib/minio';

export const docusealWebhookRouter = Router();

const WEBHOOK_TOKEN = process.env['DOCUSEAL_WEBHOOK_TOKEN'] ?? '';
// jag_properties is single-owner (Robert) — same fallback constant lib/notifications.ts uses.
const OWNER_ID = process.env['NOTIFY_OWNER_USER_ID'] ?? '95ca3f77-60ba-4a0f-af70-2832b247b525';

interface DocusealWebhookPayload {
  event_type?: string;
  data?: { id?: number | string; submission_id?: number | string; status?: string };
}

docusealWebhookRouter.post('/', (req: Request, res: Response): void => {
  if (WEBHOOK_TOKEN) {
    const auth = req.headers['authorization'] ?? '';
    if (auth !== `Bearer ${WEBHOOK_TOKEN}`) { res.status(401).end(); return; }
  }

  // Always ack fast; do the lookup + PDF fetch fire-and-forget so DocuSeal's
  // webhook delivery is never blocked or retried by us.
  res.status(200).end();

  const payload = req.body as DocusealWebhookPayload;
  const eventType = payload.event_type ?? '';
  const submissionId = String(payload.data?.submission_id ?? payload.data?.id ?? '');
  if (!submissionId) return;

  const isCompleted = eventType.includes('completed') && eventType.startsWith('submission');
  if (!isCompleted) {
    logger.info({ entity: 'DOCUSEAL', action: 'WEBHOOK_IGNORED', event_type: eventType, submission_id: submissionId });
    return;
  }

  void (async () => {
    try {
      // Is this a Tenancy Agreement submission?
      const lease = await withOwnerRLS(propertiesPool, OWNER_ID, async c =>
        c.query<{ id: string }>(
          `SELECT id FROM prop_lease_agreements WHERE docuseal_submission_id = $1`,
          [submissionId],
        ).then(r => r.rows[0] ?? null),
      );

      if (lease) {
        const { documentUrl } = await getSubmission(submissionId);
        if (documentUrl) {
          const pdf = await downloadSignedPdf(documentUrl);
          await ensureBucket(BUCKET_SIGNED_DOCUMENTS);
          const key = mediaObjectKey(OWNER_ID, 'lease-agreements', lease.id, 'signed-agreement.pdf');
          await minioClient.putObject(BUCKET_SIGNED_DOCUMENTS, key, pdf, pdf.length, { 'Content-Type': 'application/pdf' });

          await withOwnerRLS(propertiesPool, OWNER_ID, async c =>
            c.query(
              `UPDATE prop_lease_agreements
               SET    signature_status = 'SIGNED', signed_pdf_object_key = $1, agreement_signed_at = NOW()
               WHERE  id = $2`,
              [key, lease.id],
            ),
          );
          logger.info({ entity: 'DOCUSEAL', action: 'LEASE_SIGNED', lease_id: lease.id, submission_id: submissionId });
        }
        return;
      }

      // Is this a handover condition-report submission?
      const handover = await withOwnerRLS(propertiesPool, OWNER_ID, async c =>
        c.query<{ id: string }>(
          `SELECT id FROM prop_handover_checklists WHERE docuseal_submission_id = $1`,
          [submissionId],
        ).then(r => r.rows[0] ?? null),
      );

      if (handover) {
        const { documentUrl } = await getSubmission(submissionId);
        if (documentUrl) {
          const pdf = await downloadSignedPdf(documentUrl);
          await ensureBucket(BUCKET_SIGNED_DOCUMENTS);
          const key = mediaObjectKey(OWNER_ID, 'handover-checklists', handover.id, 'signed-condition-report.pdf');
          await minioClient.putObject(BUCKET_SIGNED_DOCUMENTS, key, pdf, pdf.length, { 'Content-Type': 'application/pdf' });

          await withOwnerRLS(propertiesPool, OWNER_ID, async c =>
            c.query(
              `UPDATE prop_handover_checklists
               SET    tenant_signed = true, manager_signed = true,
                      tenant_signed_at = NOW(), manager_signed_at = NOW(),
                      signed_pdf_object_key = $1
               WHERE  id = $2`,
              [key, handover.id],
            ),
          );
          logger.info({ entity: 'DOCUSEAL', action: 'HANDOVER_SIGNED', handover_id: handover.id, submission_id: submissionId });
        }
        return;
      }

      logger.warn({ entity: 'DOCUSEAL', action: 'WEBHOOK_NO_MATCH', submission_id: submissionId });
    } catch (e) {
      logger.warn({ entity: 'DOCUSEAL', action: 'WEBHOOK_HANDLE_FAILED', error: e instanceof Error ? e.message : String(e) });
    }
  })();
});
