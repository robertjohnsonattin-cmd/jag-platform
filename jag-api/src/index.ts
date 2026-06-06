import 'dotenv/config';
import express, { type Request, type Response, type NextFunction } from 'express';
import { corePool } from './db/index';
import { logger } from './lib/logger';

const app = express();
const PORT = Number(process.env.PORT ?? 3000);

// ── WiPay webhook — mount with express.raw() BEFORE express.json() ────────────
// The webhook HMAC verification requires the raw request body as a Buffer.
// express.raw() captures it; express.json() below would replace it with a
// parsed object and destroy the original bytes needed for HMAC.
import { wipayRouter } from './routes/webhooks/wipay';
app.use('/api/v1/webhooks/wipay', express.raw({ type: 'application/json' }), wipayRouter);

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

app.use('/api/v1/auth',          authRouter);
app.use('/api/v1/me',            meRouter);
app.use('/api/v1/tenants',       tenantsRouter);
app.use('/api/v1/notifications', notificationsRouter);
app.use('/api/v1/ims',           imsRouter);
app.use('/api/v1/jabco',         jabcoRouter);
app.use('/api/v1/properties',    propertiesRouter);
app.use('/api/v1/crm',           crmRouter);
app.use('/api/v1/family',        familyRouter);
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
  app.listen(PORT, () => {
    logger.info({
      entity: 'API',
      action: 'STARTUP',
      port: PORT,
      env: process.env.NODE_ENV ?? 'development',
    });
  });
}

export default app;
