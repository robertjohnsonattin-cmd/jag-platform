import { createHmac, timingSafeEqual } from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { config } from '../config';

export function verifyWiPaySignature(req: Request, res: Response, next: NextFunction): void {
  const signature = req.headers['x-wipay-signature'] as string | undefined;

  if (!signature?.startsWith('sha256=')) {
    res.status(401).json({
      success: false,
      data: null,
      error: 'Webhook signature missing.',
      code: 'INVALID_SIGNATURE',
    });
    return;
  }

  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!rawBody) {
    res.status(400).json({
      success: false,
      data: null,
      error: 'Request body missing.',
      code: 'VALIDATION_ERROR',
    });
    return;
  }

  const expected =
    'sha256=' +
    createHmac('sha256', config.wipayWebhookSecret).update(rawBody).digest('hex');

  let valid = false;
  try {
    const sigBuf = Buffer.from(signature, 'utf8');
    const expBuf = Buffer.from(expected, 'utf8');
    valid = sigBuf.length === expBuf.length && timingSafeEqual(sigBuf, expBuf);
  } catch {
    valid = false;
  }

  if (!valid) {
    res.status(401).json({
      success: false,
      data: null,
      error: 'Webhook signature validation failed.',
      code: 'INVALID_SIGNATURE',
    });
    return;
  }

  next();
}
