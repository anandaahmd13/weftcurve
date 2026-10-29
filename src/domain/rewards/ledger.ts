import type { PoolClient } from 'pg';
export interface Posting { account:string; amount:bigint }
export async function postJournal(c:PoolClient,event:string,projectId:string,entries:Posting[]) {
  if(entries.reduce((sum,e)=>sum+e.amount,0n)!==0n)throw new Error('Journal entries do not balance.');
  if(entries.length<2)throw new Error('Journal requires at least two balanced entries.');
  await c.query('INSERT INTO journal(event_id,project_id,entries) VALUES($1,$2,$3)',[event,projectId,JSON.stringify(entries.map(e=>({...e,amount:e.amount.toString()})))]);
}
