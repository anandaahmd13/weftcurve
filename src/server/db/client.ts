import { Pool, type PoolClient } from 'pg';
import { databaseUrl } from '../config';
const globalDb = globalThis as unknown as { weftPool?: Pool };
export const db = globalDb.weftPool ?? new Pool({connectionString:databaseUrl,max:8});
globalDb.weftPool = db;
export async function transaction<T>(fn:(client:PoolClient)=>Promise<T>):Promise<T> {
  const client=await db.connect();
  try { await client.query('BEGIN'); const result=await fn(client); await client.query('COMMIT'); return result; }
  catch(error){ await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
