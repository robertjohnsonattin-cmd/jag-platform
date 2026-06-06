import 'dotenv/config';

function required(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

function int(name: string, fallback: number): number {
  const val = process.env[name];
  return val ? parseInt(val, 10) : fallback;
}

export const config = {
  pollIntervalMs: int('POLL_INTERVAL_MS', 5000),
  batchSize: int('BATCH_SIZE', 10),
  maxRetries: int('MAX_RETRIES', 3),
  alertUserId: required('ALERT_USER_ID'),
  db: {
    core: required('DATABASE_URL_CORE'),
    commercial: required('DATABASE_URL_COMMERCIAL'),
    entertainment: required('DATABASE_URL_ENTERTAINMENT'),
    family: required('DATABASE_URL_FAMILY'),
    properties: required('DATABASE_URL_PROPERTIES'),
  },
} as const;
