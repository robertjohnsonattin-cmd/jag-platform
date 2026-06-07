// STD-08: Structured logging — every server event is a JSON object with required fields.
// No console.log() in production code. All modules import from here.

type Severity = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

interface LogFields {
  entity: string;
  action: string;
  user_id?: string;
  tenant_id?: string;
  [key: string]: unknown;
}

interface ErrorFields extends LogFields {
  error_code?: string;
  error_message?: string;
  stack?: string;
}

// Fields whose values are always replaced with '[REDACTED]' before logging.
const SENSITIVE_KEYS = new Set([
  'password', 'secret', 'token', 'api_key', 'apikey', 'authorization',
  'credential', 'private_key', 'client_secret', 'access_token', 'refresh_token',
  'webhook_secret', 'db_password', 'minio_secret',
]);

function redact(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    out[k] = SENSITIVE_KEYS.has(k.toLowerCase()) ? '[REDACTED]' : v;
  }
  return out;
}

function emit(severity: Severity, fields: LogFields | ErrorFields): void {
  process.stdout.write(
    JSON.stringify({ timestamp: new Date().toISOString(), severity, ...redact(fields as Record<string, unknown>) }) + '\n',
  );
}

export const logger = {
  debug: (fields: LogFields) => emit('DEBUG', fields),
  info:  (fields: LogFields) => emit('INFO', fields),
  warn:  (fields: ErrorFields) => emit('WARN', fields),
  error: (fields: ErrorFields) => emit('ERROR', fields),
};
