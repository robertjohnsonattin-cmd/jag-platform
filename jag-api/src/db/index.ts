import { Pool } from 'pg';

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

// One pool per logical database (STD-01: modules connect only to their own DB).
// Pools are lazily initialised — the getter defers Pool construction until first
// access. This prevents test suites from failing at module load time when only
// a subset of database env vars are set.
//
// IMPORTANT: the Proxy must bind methods to the real Pool instance so that
// pool.connect(), pool.query() etc. have the correct `this` context.

function makeLazyPool(envVar: string): Pool {
  let _pool: Pool | null = null;

  const getPool = (): Pool => {
    if (!_pool) _pool = new Pool({ connectionString: requireEnv(envVar) });
    return _pool;
  };

  return new Proxy({} as Pool, {
    get(_target, prop) {
      const pool = getPool();
      const val = (pool as unknown as Record<string | symbol, unknown>)[prop];
      // Bind functions to the real Pool instance so `this` is correct.
      if (typeof val === 'function') return val.bind(pool);
      return val;
    },
  });
}

export const corePool          = makeLazyPool('DATABASE_URL_CORE');
export const commercialPool    = makeLazyPool('DATABASE_URL_COMMERCIAL');
export const entertainmentPool = makeLazyPool('DATABASE_URL_ENTERTAINMENT');
export const familyPool        = makeLazyPool('DATABASE_URL_FAMILY');
export const propertiesPool    = makeLazyPool('DATABASE_URL_PROPERTIES');

export async function closePools(): Promise<void> {
  // Only close pools that were actually initialised.
  const poolVars = [
    'DATABASE_URL_CORE', 'DATABASE_URL_COMMERCIAL', 'DATABASE_URL_ENTERTAINMENT',
    'DATABASE_URL_FAMILY', 'DATABASE_URL_PROPERTIES',
  ];
  await Promise.all(
    poolVars.map(v => {
      try {
        return process.env[v] ? (new Pool({ connectionString: process.env[v] })).end() : Promise.resolve();
      } catch { return Promise.resolve(); }
    }),
  );
}
