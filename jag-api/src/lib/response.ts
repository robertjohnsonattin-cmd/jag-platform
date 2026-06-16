// STD-06: Standard JAG API envelope for all responses.
// Success: { success: true,  data: <payload> }
// Error:   { success: false, data: null, error: '<human message>', code: '<ERROR_CODE>' }
//
// Two calling conventions are supported:
//   ok(res, data, status?) — existing routes: sends response directly
//   ok(data)               — new tenancy routes: returns envelope object for res.json()
//   err(res, status, code, message) — existing routes: sends response directly
//   err(message, code)              — new tenancy routes: returns envelope object for res.status().json()

import type { Response } from 'express';

// Overload 1 — existing routes: sends response directly
export function ok<T>(res: Response, data: T, status?: number): void;
// Overload 2 — new tenancy routes: returns envelope object
export function ok<T>(data: T): { success: true; data: T };
export function ok<T>(
  resOrData: Response | T,
  data?: T,
  status = 200,
): void | { success: true; data: T } {
  if (
    resOrData !== null &&
    typeof resOrData === 'object' &&
    typeof (resOrData as Record<string, unknown>)['json'] === 'function'
  ) {
    (resOrData as Response).status(status).json({ success: true, data });
  } else {
    return { success: true, data: resOrData as T };
  }
}

// Overload 1 — existing routes: sends response directly
export function err(res: Response, status: number, code: string, message: string): void;
// Overload 2 — new tenancy routes: returns envelope object
export function err(message: string, code: string): { success: false; data: null; error: string; code: string };
export function err(
  resOrMessage: Response | string,
  statusOrCode: number | string,
  code?: string,
  message?: string,
): void | { success: false; data: null; error: string; code: string } {
  if (typeof resOrMessage === 'string') {
    return { success: false, data: null, error: resOrMessage, code: statusOrCode as string };
  } else {
    (resOrMessage as Response).status(statusOrCode as number).json({
      success: false,
      data: null,
      error: message,
      code,
    });
  }
}
