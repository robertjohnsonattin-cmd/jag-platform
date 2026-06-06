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
  databaseUrl: required('DATABASE_URL_PROPERTIES'),
  wipayWebhookSecret: required('WIPAY_WEBHOOK_SECRET'),
  ownerId: required('OWNER_ID'),
  port: int('PORT', 3000),
} as const;
