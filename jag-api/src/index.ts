import 'dotenv/config';
import express, { type Request, type Response, type NextFunction } from 'express';
import { corePool } from './db/index';
import { logger } from './lib/logger';

const app = express();
const PORT = Number(process.env.PORT ?? 3000);

// ── Security headers (STD-12: no security regressions to production) ──────────
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.removeHeader('X-Powered-By');
  next();
});

// ── In-memory rate limiter — 300 req/min per IP ───────────────────────────────
// Resets every 60 s window. SSE /listen is exempt — it's a long-lived connection.
const _rateWindows = new Map<string, { count: number; reset: number }>();
app.use((req: Request, res: Response, next: NextFunction) => {
  // SSE endpoint holds one persistent connection — exclude from per-request counting
  if (req.path === '/api/v1/finance/document-jobs/listen') return next();
  const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim()
           ?? req.socket.remoteAddress ?? 'unknown';
  const now = Date.now();
  const window = _rateWindows.get(ip);
  if (!window || now > window.reset) {
    _rateWindows.set(ip, { count: 1, reset: now + 60_000 });
    return next();
  }
  window.count += 1;
  if (window.count > 1000) {
    res.status(429).json({ success: false, data: null, error: 'Too many requests. Retry after 60 s.', code: 'RATE_LIMITED' });
    return;
  }
  next();
});

// ── Unhandled promise rejections — log and exit cleanly ───────────────────────
process.on('unhandledRejection', (reason) => {
  logger.error({ entity: 'API', action: 'UNHANDLED_REJECTION', error_message: String(reason) });
  process.exit(1);
});
process.on('uncaughtException', (error) => {
  logger.error({ entity: 'API', action: 'UNCAUGHT_EXCEPTION', error_message: error.message, stack: error.stack });
  process.exit(1);
});

// ── WiPay webhook — mount with express.raw() BEFORE express.json() ────────────
// The webhook HMAC verification requires the raw request body as a Buffer.
// express.raw() captures it; express.json() below would replace it with a
// parsed object and destroy the original bytes needed for HMAC.
import { wipayRouter } from './routes/webhooks/wipay';
app.use('/api/v1/webhooks/wipay', express.raw({ type: 'application/json', limit: '64kb' }), wipayRouter);

// ── WhatsApp webhook — same reason, must also mount BEFORE express.json() ─────
// Previously mounted after the global json() below, so the body arrived
// already parsed into an Object — Hmac.update() threw on every inbound
// webhook (TypeError: "data" argument must be ... Buffer ... Received an
// instance of Object), meaning no WhatsApp webhook had ever succeeded.
import { whatsappWebhookRouter } from './routes/internal/whatsapp-webhook';
app.use('/internal/whatsapp/webhook', express.raw({ type: 'application/json', limit: '1mb' }),
  (req, _res, next) => {
    // express.raw() consumed the stream into req.body (a Buffer) for HMAC.
    // Chaining express.json() here would find the stream already consumed and
    // leave req.body = {} — so the handler saw zero entries and processed
    // nothing (200 OK but no message ingested). Parse the Buffer manually
    // instead, same pattern as the WiPay webhook. Keep the Buffer on rawBody
    // for X-Hub-Signature-256 verification.
    const buf = req.body as Buffer;
    (req as typeof req & { rawBody?: Buffer }).rawBody = Buffer.isBuffer(buf) ? buf : Buffer.alloc(0);
    try {
      req.body = Buffer.isBuffer(buf) && buf.length ? JSON.parse(buf.toString('utf8')) : {};
    } catch {
      req.body = {};
    }
    next();
  },
  whatsappWebhookRouter);

// ── Documenso webhook — mount BEFORE the global express.json() with a large
// limit. Documenso's DOCUMENT_COMPLETED payload embeds the full base64-encoded
// signed PDF, so a real lease/handover webhook body is ~400kb+ — well over
// express.json()'s default 100kb limit. Under the global 100kb parser the body
// was silently rejected (413-class), leaving req.body empty, so the handler
// read documentId='' and returned early WITHOUT updating our record — every
// completed signature stayed stuck at signature_status='SENT'. Auth here is a
// secret header (X-Documenso-Secret), not an HMAC over the raw bytes, so a
// normal (large-limit) JSON parse is fine — no raw-buffer capture needed.
import { documensoWebhookRouter } from './routes/internal/documenso-webhook';
app.use('/internal/documenso-webhook', express.json({ limit: '10mb' }), documensoWebhookRouter);

// ── JSON body parser (all other routes) ───────────────────────────────────────
app.use(express.json());

// ── Health endpoints ───────────────────────────────────────────────────────────
// Not under /api/v1/ — infrastructure probes used by Docker and load balancers.
//
// /health/live  — liveness probe: is the Node process alive? Always 200.
// /health/ready — readiness probe: can we reach jag_core PostgreSQL? 503 until ready.

app.get('/health/live', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

app.get('/health/ready', async (_req: Request, res: Response) => {
  try {
    const client = await corePool.connect();
    try {
      await client.query('SELECT 1');
    } finally {
      client.release();
    }
    res.json({ status: 'ready' });
  } catch {
    res.status(503).json({ status: 'not_ready', error: 'database_unreachable' });
  }
});

// ── Internal routes (Docker-network-only, no Keycloak auth) ──────────────────
import { minioAuditRouter } from './routes/internal/minio-audit';
app.use('/internal/minio-audit', minioAuditRouter);

import { crmCalendarBackfillRouter } from './routes/internal/crm-calendar-backfill';
app.use('/internal/crm/backfill-calendar', crmCalendarBackfillRouter);

import { calendarBackfillRouter } from './routes/internal/calendar-backfill';
app.use('/internal/calendar/backfill', calendarBackfillRouter);

import { traccarEventRouter } from './routes/internal/traccar-event';
app.use('/internal/traccar-event', traccarEventRouter);

import { batterySyncRouter } from './routes/internal/traccar-event';
app.use('/internal/gps/battery-sync', batterySyncRouter);

import { documensoReconcileRouter } from './routes/internal/documenso-reconcile';
app.use('/internal/documenso-reconcile', express.json(), documensoReconcileRouter);

import { grafanaAlertWebhookRouter } from './routes/internal/grafana-alert-webhook';
app.use('/internal/grafana-alert-webhook', grafanaAlertWebhookRouter);

// documensoWebhookRouter is mounted above, before the global express.json()
// (its payload exceeds the default 100kb limit — see the comment there).

// ── Public routes (no Keycloak auth) — property booking page API ──────────────
import { publicBookingRouter, publicScheduleRouter } from './routes/properties/viewings';
import { publicApplyRouter } from './routes/properties/public-apply';
import { publicLeaseCopyRouter } from './routes/properties/public-lease-copy';
import { bookPreviewRouter } from './routes/properties/book-preview';
import { generateApplicationFormPDF } from './lib/application-form-pdf';
app.use('/api/v1/public/book', express.json(), publicBookingRouter);
app.use('/api/v1/public/schedule', express.json(), publicScheduleRouter);
app.use('/api/v1/public/apply', express.json(), publicApplyRouter);
app.use('/api/v1/public/lease-copy', express.json(), publicLeaseCopyRouter);

// Public PDF application form (no auth required)
app.get('/api/v1/public/applications/form.pdf', (_req: Request, res: Response, next: NextFunction) => {
  try {
    const doc = generateApplicationFormPDF();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="JAG_Properties_Rental_Application.pdf"');
    doc.pipe(res);
    doc.end();
  } catch (e) { next(e); }
});

// Crawler-only preview for shared booking links — Caddy routes ONLY known
// crawler User-Agents at /book/* here (see Caddyfile); real browsers hit the
// SPA at the same path and never reach this route. See book-preview.ts.
app.use('/book', bookPreviewRouter);

// ── Phase 1B routes (STD-05: all API routes prefixed /api/v1/) ─────────────────
import { authRouter }          from './routes/auth';
import { meRouter }            from './routes/me';
import { tenantsRouter }       from './routes/tenants';
import { notificationsRouter } from './routes/notifications';
import { imsRouter }           from './routes/ims/index';
import { jabcoRouter }         from './routes/jabco/index';
import { propertiesRouter }    from './routes/properties/index';
import { crmRouter }           from './routes/crm/index';
import { familyRouter }        from './routes/family/index';
import { ownershipRouter }     from './routes/family/ownership';
import { docvaultRouter }      from './routes/docvault/index';
import { successionRouter }    from './routes/succession/index';
import { lifestyleRouter }     from './routes/lifestyle/index';
import { barRouter }            from './routes/bar/index';
import { clubRouter }           from './routes/club/index';
import { brianRouter }           from './routes/brian/index';
import { nlcbRouter }            from './routes/nlcb/index';
import { dragonbridgeRouter }    from './routes/dragonbridge/index';
import { entertainmentRouter }   from './routes/entertainment/index';
import { financeRouter }         from './routes/finance/index';
import { filesRouter }           from './routes/files/index';
import { hrRouter }              from './routes/hr/index';

app.use('/api/v1/auth',          authRouter);
app.use('/api/v1/me',            meRouter);
app.use('/api/v1/tenants',       tenantsRouter);
app.use('/api/v1/notifications', notificationsRouter);
app.use('/api/v1/ims',           imsRouter);
app.use('/api/v1/jabco',         jabcoRouter);
app.use('/api/v1/properties',    propertiesRouter);
app.use('/api/v1/crm',           crmRouter);
app.use('/api/v1/family',        familyRouter);
app.use('/api/v1/family',        ownershipRouter);
app.use('/api/v1/docvault',      docvaultRouter);
app.use('/api/v1/succession',    successionRouter);
app.use('/api/v1/lifestyle',     lifestyleRouter);
app.use('/api/v1/bar',          barRouter);
app.use('/api/v1/club',         clubRouter);
app.use('/api/v1/brian',        brianRouter);
app.use('/api/v1/nlcb',         nlcbRouter);
app.use('/api/v1/dragonbridge',   dragonbridgeRouter);
app.use('/api/v1/entertainment', entertainmentRouter);
app.use('/api/v1/finance',       financeRouter);
app.use('/api/v1/files',         filesRouter);
app.use('/api/v1/hr',            hrRouter);

import { adminCalendarBackfillRouter } from './routes/admin/calendar-backfill';
app.use('/api/v1/admin/calendar', adminCalendarBackfillRouter);

// ── Global error handler ───────────────────────────────────────────────────────
// Must be defined after all routes. Four-argument signature required by Express.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({
    entity: 'API',
    action: 'UNHANDLED_ERROR',
    error_code: 'INTERNAL_SERVER_ERROR',
    error_message: error.message,
    stack: error.stack,
  });
  res.status(500).json({
    success: false,
    data: null,
    error: 'An unexpected error occurred. Please try again.',
    code: 'INTERNAL_SERVER_ERROR',
  });
});

// ── Start ──────────────────────────────────────────────────────────────────────
// Only bind the port when running as the main entry point, not when imported
// by test suites. Supertest creates its own ephemeral server on each request.
if (require.main === module) {
  const server = app.listen(PORT, () => {
    logger.info({
      entity: 'API',
      action: 'STARTUP',
      port: PORT,
      env: process.env.NODE_ENV ?? 'development',
    });
  });

  // Graceful shutdown — finish in-flight requests before exit
  const shutdown = (signal: string) => {
    logger.info({ entity: 'API', action: 'SHUTDOWN', signal });
    server.close(() => {
      logger.info({ entity: 'API', action: 'SHUTDOWN_COMPLETE' });
      process.exit(0);
    });
    // Force exit after 10 s if connections don't drain
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

export default app;
