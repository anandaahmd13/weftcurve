import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { db, transaction } from './client';
export async function migrate() {
  await transaction(async c=>{
    await c.query("SELECT pg_advisory_xact_lock(891223)");
    await c.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz DEFAULT now())');
    const dir=resolve('src/server/db/migrations');
    for(const file of (await readdir(dir)).filter(f=>f.endsWith('.sql')).sort()) {
      if((await c.query('SELECT 1 FROM schema_migrations WHERE name=$1',[file])).rowCount)continue;
      await c.query(await readFile(resolve(dir,file),'utf8'));
      await c.query('INSERT INTO schema_migrations(name) VALUES($1)',[file]);
    }
  });
}
if (process.argv[1]?.endsWith('migrate.ts')) migrate().then(()=>console.log('Migrasi database selesai.')).finally(()=>db.end());
