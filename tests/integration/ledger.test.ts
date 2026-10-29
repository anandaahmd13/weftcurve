import { beforeAll,afterAll,describe,it,expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db,transaction } from '../../src/server/db/client';
import { migrate } from '../../src/server/db/migrate';
import { createProject,trade,distribute,claimReward } from '../../src/server/service';
import { tick } from '../../src/worker/jobs';
const prefix=randomUUID();const creator='sim:test-creator-'+prefix;const a='sim:test-a-'+prefix;const b='sim:test-b-'+prefix;
beforeAll(async()=>{await migrate();for(const wallet of [creator,a,b])await db.query('INSERT INTO wallets(address,label) VALUES($1,$1)',[wallet]);});
afterAll(()=>db.end());
describe('database reward lifecycle',()=>{
 it('launch, trade, allocate, reserve concurrently, payout exactly once in simulator',async()=>{
  const input={name:'Test thread',symbol:'TEST',description:'Integration fixture',mode:'holders',holderShareBps:10000};
  const key=randomUUID();const first=await createProject(creator,key,input);const retry=await createProject(creator,key,input);expect(retry.project.id).toBe(first.project.id);
  const id=first.project.id;
  const tradeKey=randomUUID();await trade(a,tradeKey,id,{side:'buy',amount:'0.6'});await trade(a,tradeKey,id,{side:'buy',amount:'0.6'});
  expect((await db.query('SELECT volume FROM projects WHERE id=$1',[id])).rows[0].volume).toBe('600000000');
  await distribute(a,randomUUID(),id);
  const result=await Promise.allSettled([claimReward(a,randomUUID(),id),claimReward(a,randomUUID(),id)]);
  expect(result.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  const claim=(result.find(r=>r.status==='fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof claimReward>>>).value.claim;
  await db.query("UPDATE jobs SET created_at=now()-interval '2 seconds' WHERE claim_id=$1",[claim.id]);
  await tick();await tick();await tick();
  expect((await db.query('SELECT status FROM claims WHERE id=$1',[claim.id])).rows[0].status).toBe('finalized');
  expect(Number((await db.query('SELECT count(*) FROM journal WHERE event_id=$1',['payout:'+claim.id])).rows[0].count)).toBe(1);
  const r=(await db.query('SELECT * FROM rewards WHERE project_id=$1 AND wallet=$2',[id,a])).rows[0];expect(r.available).toBe('0');expect(r.reserved).toBe('0');expect(BigInt(r.paid)>0n).toBe(true);
  await expect(db.query("UPDATE journal SET entries='[]' WHERE project_id=$1",[id])).rejects.toThrow('append-only');
 });
 it('preserves accrued reward when token is sold',async()=>{
  const {project}=await createProject(creator,randomUUID(),{name:'Retained',symbol:'KEEP',description:'',mode:'holders',recipients:[]});
  await trade(a,randomUUID(),project.id,{side:'buy',amount:'0.2'});await distribute(a,randomUUID(),project.id);
  const before=(await db.query('SELECT available FROM rewards WHERE project_id=$1 AND wallet=$2',[project.id,a])).rows[0].available;
  await trade(a,randomUUID(),project.id,{side:'sell',amount:'10000'});
  expect((await db.query('SELECT available FROM rewards WHERE project_id=$1 AND wallet=$2',[project.id,a])).rows[0].available).toBe(before);
 });
 it('rolls back unbalanced or failed transactions',async()=>{
  const before=(await db.query('SELECT balance FROM wallets WHERE address=$1',[b])).rows[0].balance;
  await expect(transaction(async c=>{await c.query('UPDATE wallets SET balance=0 WHERE address=$1',[b]);throw new Error('crash');})).rejects.toThrow('crash');
  expect((await db.query('SELECT balance FROM wallets WHERE address=$1',[b])).rows[0].balance).toBe(before);
 });
});
