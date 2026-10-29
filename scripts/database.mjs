import EmbeddedPostgres from 'embedded-postgres';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
const dir = resolve('.data/postgres');
mkdirSync(resolve('.data'), {recursive:true, mode:0o700});
const postgres = new EmbeddedPostgres({ databaseDir:dir, user:'weft', password:'weft-local-only', port:55432, persistent:true, authMethod:'scram-sha-256', postgresFlags:['-h','127.0.0.1'], onLog:()=>{}, onError:message => console.error(String(message)) });
if (!existsSync(resolve(dir,'PG_VERSION'))) await postgres.initialise();
await postgres.start();
const client = postgres.getPgClient();
await client.connect();
for (const name of ['weftcurve_simulator','weftcurve_test','weftcurve_devnet']) {
  const {rowCount} = await client.query('SELECT 1 FROM pg_database WHERE datname=$1',[name]);
  if (!rowCount) await client.query(`CREATE DATABASE ${name}`);
}
await client.end();
console.log('PostgreSQL lokal siap: 127.0.0.1:55432 (simulator / test / devnet terpisah)');
let closing=false;
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,async()=>{if(closing)return;closing=true;await postgres.stop();process.exit(0);});
setInterval(()=>{},60_000);
