import 'dotenv/config';
import express from 'express';
import type { Request } from 'express';
import { config } from './config';
import { verifyWiPaySignature } from './middleware/verifyWiPaySignature';
import { webhooksRouter } from './routes/webhooks';

const app = express();

// Capture raw body buffer for HMAC verification before JSON parsing
app.use(
  express.json({
    verify: (req: Request & { rawBody?: Buffer }, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

app.use('/webhooks', verifyWiPaySignature, webhooksRouter);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'jag-wipay-poc' });
});

app.listen(config.port, () => {
  console.log(`[jag-wipay-poc] Listening on port ${config.port}`);
});
