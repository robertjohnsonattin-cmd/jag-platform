// Internal webhook — MinIO audit log receiver
// MinIO POSTs every file operation here (PutObject, GetObject, DeleteObject, etc.)
// We log each event as structured JSON → Promtail picks it up → Loki → Grafana.
//
// NOT under /api/v1/ and NOT behind Keycloak. Protected by MINIO_AUDIT_TOKEN
// (shared secret). Only reachable from inside the Docker network.

import { Router, type Request, type Response } from 'express';
import { logger } from '../../lib/logger';

export const minioAuditRouter = Router();

const AUDIT_TOKEN = process.env['MINIO_AUDIT_TOKEN'] ?? '';

interface MinioAuditEvent {
  version?: string;
  time?: string;
  api?: {
    name?: string;
    bucket?: string;
    object?: string;
    objects?: unknown[];
    status?: string;
    statusCode?: number;
    rx?: number;
    tx?: number;
    timeToResponse?: string;
  };
  remotehost?: string;
  requestID?: string;
  userAgent?: string;
}

minioAuditRouter.post('/', (req: Request, res: Response): void => {
  // Validate shared secret — MinIO sends it verbatim as the Authorization header.
  if (AUDIT_TOKEN) {
    const auth = req.headers['authorization'] ?? '';
    if (auth !== `Bearer ${AUDIT_TOKEN}`) {
      res.status(401).end();
      return;
    }
  }

  try {
    const event = req.body as MinioAuditEvent;
    const api   = event.api ?? {};

    logger.info({
      entity:      'MINIO_AUDIT',
      action:      api.name ?? 'UNKNOWN',
      bucket:      api.bucket ?? '',
      object:      api.object ?? (Array.isArray(api.objects) ? `[${api.objects.length} objects]` : ''),
      status:      api.status ?? '',
      status_code: api.statusCode ?? 0,
      bytes_rx:    api.rx ?? 0,
      bytes_tx:    api.tx ?? 0,
      remote_host: event.remotehost ?? '',
      request_id:  event.requestID ?? '',
      user_agent:  event.userAgent ?? '',
    });
  } catch {
    // Never let audit logging errors surface to MinIO — always return 200.
  }

  res.status(200).end();
});
