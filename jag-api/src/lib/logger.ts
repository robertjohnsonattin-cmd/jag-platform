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

function emit(severity: Severity, fields: LogFields | ErrorFields): void {
  process.stdout.write(
    JSON.stringify({ timestamp: new Date().toISOString(), severity, ...fields }) + '\n',
  );
}

export const logger = {
  debug: (fields: LogFields) => emit('DEBUG', fields),
  info:  (fields: LogFields) => emit('INFO', fields),
  warn:  (fields: ErrorFields) => emit('WARN', fields),
  error: (fields: ErrorFields) => emit('ERROR', fields),
};
