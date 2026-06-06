// STD-06: Standard JAG API envelope for all responses.
// Success: { success: true,  data: <payload> }
// Error:   { success: false, data: null, error: '<human message>', code: '<ERROR_CODE>' }

import type { Response } from 'express';

export function ok<T>(res: Response, data: T, status = 200): void {
  res.status(status).json({ success: true, data });
}

export function err(
  res: Response,
  status: number,
  code: string,
  message: string,
): void {
  res.status(status).json({ success: false, data: null, error: message, code });
}
