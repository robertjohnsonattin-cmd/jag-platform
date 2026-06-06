/**
 * Migration runner for all five JAG databases.
 *
 * Usage:
 *   npm run migrate:all                  — run all five
 *   npm run migrate:core                 — run jag_core only
 *   npm run migrate <db1> [db2] …       — run named databases
 */

import 'dotenv/config';
import { runner } from 'node-pg-migrate';
import path from 'path';

const DB_CONFIGS: Record<string, { urlVar: string; migrationsDir: string }> = {
  core: {
    urlVar: 'DATABASE_URL_CORE',
    migrationsDir: path.join(__dirname, '..', 'migrations', 'jag_core'),
  },
  commercial: {
    urlVar: 'DATABASE_URL_COMMERCIAL',
    migrationsDir: path.join(__dirname, '..', 'migrations', 'jag_commercial'),
  },
  entertainment: {
    urlVar: 'DATABASE_URL_ENTERTAINMENT',
    migrationsDir: path.join(__dirname, '..', 'migrations', 'jag_entertainment'),
  },
  family: {
    urlVar: 'DATABASE_URL_FAMILY',
    migrationsDir: path.join(__dirname, '..', 'migrations', 'jag_family'),
  },
  properties: {
    urlVar: 'DATABASE_URL_PROPERTIES',
    migrationsDir: path.join(__dirname, '..', 'migrations', 'jag_properties'),
  },
};

async function migrateOne(dbKey: string): Promise<void> {
  const cfg = DB_CONFIGS[dbKey];
  if (!cfg) {
    throw new Error(`Unknown database key: "${dbKey}". Valid keys: ${Object.keys(DB_CONFIGS).join(', ')}`);
  }

  const databaseUrl = process.env[cfg.urlVar];
  if (!databaseUrl) {
    throw new Error(`Missing env var: ${cfg.urlVar}`);
  }

  console.log(`\n→ Migrating ${dbKey} (${cfg.urlVar})…`);
  await runner({
    databaseUrl,
    dir: cfg.migrationsDir,
    migrationsTable: 'pgmigrations',
    direction: 'up',
    log: (msg) => console.log(`  ${msg}`),
  });
  console.log(`✓ ${dbKey} done`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const targets = args.length === 0 || args[0] === 'all' ? Object.keys(DB_CONFIGS) : args;

  for (const key of targets) {
    await migrateOne(key);
  }

  console.log('\nAll migrations complete.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
