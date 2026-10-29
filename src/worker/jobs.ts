import { randomUUID } from 'node:crypto';
import { transaction } from '../server/db/client';
import { network, epochSeconds } from '../server/config';
import { distributeProject,recordActivity } from '../server/service';
import { postJournal } from '../domain/rewards/ledger';
export async function tick(){
 if(network!=='simulator')return;
 await transaction(async c=>{
  await c.query('INSERT INTO worker_health(id,last_run) VALUES(1,now()) ON CONFLICT(id) DO UPDATE SET last_run=now()');
  const projects=await c.query("SELECT id FROM projects WHERE network='simulator' AND undistributed>0 AND last_epoch<now()-($1*interval '1 second') ORDER BY id FOR UPDATE SKIP LOCKED",[epochSeconds]);
  for(const p of projects.rows)await distributeProject(c,p.id);
 });
 await transaction(async c=>{
  const job=(await c.query("SELECT * FROM jobs WHERE status='ready' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1")).rows[0];
  if(!job)return;
  const claim=(await c.query('SELECT * FROM claims WHERE id=$1 FOR UPDATE',[job.claim_id])).rows[0];
  if(claim.status!=='reserved'){await c.query("UPDATE jobs SET status='done' WHERE id=$1",[job.id]);return;}
  // Simulation records its deterministic identity before its separate settlement phase.
  const signature='sim-payout-'+claim.id;
  await c.query("UPDATE claims SET status='submitted',signature=$2,raw_transaction=$3,updated_at=now() WHERE id=$1",[claim.id,signature,JSON.stringify({simulation:true,claim:claim.id,wallet:claim.wallet,amount:claim.amount})]);
  await c.query("UPDATE jobs SET status='submitted',attempts=attempts+1 WHERE id=$1",[job.id]);
 });
 await transaction(async c=>{
  const job=(await c.query("SELECT * FROM jobs WHERE status='submitted' AND created_at<now()-interval '1 second' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1")).rows[0];
  if(!job)return;
  const claim=(await c.query('SELECT * FROM claims WHERE id=$1 FOR UPDATE',[job.claim_id])).rows[0];
  const p=(await c.query("SELECT * FROM projects WHERE id=$1 AND network='simulator' FOR UPDATE",[claim.project_id])).rows[0];
  if(!p)throw new Error('Simulator payouts cannot access devnet projects.');
  const liability=(await c.query('SELECT coalesce(sum(available+reserved),0) total FROM rewards WHERE project_id=$1',[p.id])).rows[0];
  if(BigInt(p.custody)<BigInt(liability.total)+BigInt(p.undistributed)){
   await c.query("UPDATE claims SET status='review',updated_at=now() WHERE id=$1",[claim.id]);await c.query("UPDATE jobs SET status='review' WHERE id=$1",[job.id]);return;
  }
  const amount=BigInt(claim.amount);
  const reward=(await c.query('SELECT * FROM rewards WHERE project_id=$1 AND wallet=$2 FOR UPDATE',[p.id,claim.wallet])).rows[0];
  if(BigInt(reward.reserved)<amount)throw new Error('Payout reservation does not match.');
  await c.query('UPDATE rewards SET reserved=reserved-$3,paid=paid+$3 WHERE project_id=$1 AND wallet=$2',[p.id,claim.wallet,amount.toString()]);
  await c.query('UPDATE projects SET custody=custody-$2 WHERE id=$1',[p.id,amount.toString()]);
  await c.query('UPDATE wallets SET balance=balance+$2 WHERE address=$1',[claim.wallet,amount.toString()]);
  await postJournal(c,'payout:'+claim.id,p.id,[{account:'reward:reserved:'+claim.wallet,amount:-amount},{account:'reward:paid:'+claim.wallet,amount}]);
  await c.query("UPDATE claims SET status='finalized',updated_at=now() WHERE id=$1",[claim.id]);
  await c.query("UPDATE jobs SET status='done' WHERE id=$1",[job.id]);
  await recordActivity(c,p.id,claim.wallet,'payout',amount,claim.signature);
 });
}
export const workerInstance=randomUUID();
