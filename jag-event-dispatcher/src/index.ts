import { pools, closeAllPools } from './db';
import { startPollingLoop } from './dispatcher';
import { coreHandlers } from './handlers/core';
import { commercialHandlers } from './handlers/commercial';
import { entertainmentHandlers } from './handlers/entertainment';
import { familyHandlers } from './handlers/family';
import { propertiesHandlers } from './handlers/properties';

const signal = { running: true };

const databases = [
  { name: 'jag_core',          pool: pools.core,          handlers: coreHandlers },
  { name: 'jag_commercial',    pool: pools.commercial,    handlers: commercialHandlers },
  { name: 'jag_entertainment', pool: pools.entertainment, handlers: entertainmentHandlers },
  { name: 'jag_family',        pool: pools.family,        handlers: familyHandlers },
  { name: 'jag_properties',    pool: pools.properties,    handlers: propertiesHandlers },
];

async function shutdown(reason: string): Promise<void> {
  console.log(`\nShutting down (${reason}) — waiting for in-flight polls to finish…`);
  signal.running = false;
  await closeAllPools();
  console.log('Shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

console.log('jag-event-dispatcher starting…');

const loops = databases.map(({ name, pool, handlers }) =>
  startPollingLoop(pool, pools.core, name, handlers, signal),
);

Promise.all(loops).catch((err) => {
  console.error('Fatal error in polling loop:', err);
  process.exit(1);
});
