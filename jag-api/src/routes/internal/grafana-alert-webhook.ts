// Internal webhook — Grafana alert receiver
// Grafana's unified alerting POSTs here when the "Backup pipeline failures"
// alert rule fires (severity=ERROR in the jag-cron-scripts Loki stream —
// backup-databases.sh / backup-minio-buckets.sh / backup-secrets.sh /
// restore-test.sh). We turn it into a JAG bell notification so a failure
// is actually seen, not just logged — the same class of blind spot that
// let the original DB backup silently fail for a month.
//
// NOT under /api/v1/ and NOT behind Keycloak. Protected by
// GRAFANA_ALERT_WEBHOOK_TOKEN (shared secret). Only reachable from inside
// the Docker network.

import { Router, type Request, type Response } from 'express';
import { logger } from '../../lib/logger';
import { enqueueNotification } from '../../lib/notifications';
import { withOwnerRLS } from '../../middleware/rls';
import { corePool } from '../../db/index';

export const grafanaAlertWebhookRouter = Router();

const WEBHOOK_TOKEN = process.env['GRAFANA_ALERT_WEBHOOK_TOKEN'] ?? '';
const SYSTEM_USER = process.env['NOTIFY_OWNER_USER_ID'] ?? '95ca3f77-60ba-4a0f-af70-2832b247b525';
const DEDUP_WINDOW_HOURS = 3;

interface GrafanaAlert {
  status?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  startsAt?: string;
}

interface GrafanaWebhookPayload {
  status?: string;
  alerts?: GrafanaAlert[];
  title?: string;
}

grafanaAlertWebhookRouter.post('/', (req: Request, res: Response): void => {
  if (WEBHOOK_TOKEN) {
    const auth = req.headers['authorization'] ?? '';
    if (auth !== `Bearer ${WEBHOOK_TOKEN}`) {
      res.status(401).end();
      return;
    }
  }

  // Respond immediately — Grafana doesn't need to wait on our notification
  // insert, and we don't want a slow DB to make Grafana think delivery failed.
  res.status(200).end();

  void (async () => {
    try {
      const payload = req.body as GrafanaWebhookPayload;
      const alerts = (payload.alerts ?? []).filter(a => a.status === 'firing');

      for (const alert of alerts) {
        const ruleName = alert.labels?.['alertname'] ?? 'Backup pipeline alert';
        const summary = alert.annotations?.['summary'] ?? alert.annotations?.['description'] ?? '';

        logger.warn({
          entity: 'GRAFANA_ALERT', action: 'FIRING', rule: ruleName, summary,
        });

        const recentAlert = await withOwnerRLS(corePool, SYSTEM_USER, (c) =>
          c.query(
            `SELECT id FROM notification_queue
             WHERE payload->>'kind' = 'BACKUP_ALERT'
               AND payload->>'rule' = $1
               AND created_at > NOW() - INTERVAL '${DEDUP_WINDOW_HOURS} hours'
             LIMIT 1`,
            [ruleName],
          ),
        ).catch(() => ({ rows: [] as { id: string }[] }));

        if (recentAlert.rows.length === 0) {
          void enqueueNotification({
            tier: 1,
            title: `Backup pipeline: ${ruleName}`,
            body: summary || 'A backup or restore-test script logged an error. Check Grafana / /var/log/jag-*.log on the VM.',
            payload: { kind: 'BACKUP_ALERT', rule: ruleName, summary },
          });
        }
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      logger.error({ entity: 'GRAFANA_ALERT', action: 'HANDLER_FAILED', error: errMsg });
    }
  })();
});
