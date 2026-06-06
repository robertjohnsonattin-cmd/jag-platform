import { Pool } from 'pg';
import { config } from './config';

export const pools = {
  core: new Pool({ connectionString: config.db.core }),
  commercial: new Pool({ connectionString: config.db.commercial }),
  entertainment: new Pool({ connectionString: config.db.entertainment }),
  family: new Pool({ connectionString: config.db.family }),
  properties: new Pool({ connectionString: config.db.properties }),
};

export async function closeAllPools(): Promise<void> {
  await Promise.all(Object.values(pools).map((p) => p.end()));
}
