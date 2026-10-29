import { readFile } from 'node:fs/promises';
import { Keypair } from '@solana/web3.js';
import { db,transaction } from '../server/db/client';
import { network } from '../server/config';
import { DevnetPayoutSigner,type AuthorizedPayoutJob,type SignedPayoutAttempt,type PayoutJobStore } from '../server/signing/payout';
import { devnetConnection,loadKeys } from '../server/devnet';
import { postJournal } from '../domain/rewards/ledger';
import { recordActivity } from '../server/service';
export async function feePayer(){const path=process.env.DEVNET_FEE_PAYER_FILE;if(!path)throw new Error('DEVNET_FEE_PAYER_FILE is required.');return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(path,'utf8'))));}
export class PostgresPayoutStore implements PayoutJobStore {
 constructor(private readonly feePayerAddress:string){}
 async loadAuthorizedJob(id:string):Promise<AuthorizedPayoutJob|null>{
  const r=(await db.query(`SELECT c.*,p.network,p.custody,p.undistributed,x.collector,r.reserved,
   (SELECT coalesce(sum(available+reserved),0) FROM rewards WHERE project_id=p.id) liability
   FROM claims c JOIN projects p ON p.id=c.project_id JOIN chain_projects x ON x.project_id=p.id JOIN rewards r ON r.project_id=p.id AND r.wallet=c.wallet
   WHERE c.id=$1 AND p.network='devnet' AND c.status IN ('reserved','submitted','review')`,[id])).rows[0];
  if(!r||BigInt(r.reserved)<BigInt(r.amount)||BigInt(r.custody)<BigInt(r.liability)+BigInt(r.undistributed))return null;
  return {id,projectId:r.project_id,reservationId:id,network:'devnet',asset:'SOL',claimant:r.wallet,destination:r.wallet,amountLamports:r.amount,reserveAddress:r.collector,feePayerAddress:this.feePayerAddress,status:r.status};
 }
 async getSignedAttempt(id:string){return (await db.query('SELECT signed_attempt FROM claims WHERE id=$1',[id])).rows[0]?.signed_attempt??null;}
 async saveSignedAttemptIfAbsent(attempt:SignedPayoutAttempt):Promise<SignedPayoutAttempt>{
  return transaction(async c=>{
   const r=(await c.query('SELECT * FROM claims WHERE id=$1 FOR UPDATE',[attempt.jobId])).rows[0];
   if(!r||!['reserved','submitted','review'].includes(r.status))throw new Error('Reservation is not active.');
   if(r.signed_attempt)return r.signed_attempt;
   await c.query("UPDATE claims SET signed_attempt=$2,signature=$3,raw_transaction=$4,blockhash=$5,last_valid_block_height=$6,status='submitted',updated_at=now() WHERE id=$1",[attempt.jobId,JSON.stringify(attempt),attempt.signature,attempt.transactionBase64,attempt.blockhash,attempt.lastValidBlockHeight]);return attempt;
  });
 }
}
export async function processDevnetPayouts(){
 if(network!=='devnet'||process.env.ENABLE_DEVNET_REWARDS!=='true')return;
 const payer=await feePayer();const connection=devnetConnection();
 const jobs=(await db.query("SELECT c.id,x.intent_id FROM claims c JOIN chain_projects x ON x.project_id=c.project_id WHERE c.status IN ('reserved','submitted') ORDER BY c.created_at LIMIT 10")).rows;
 for(const job of jobs){
  const lock=await db.connect();
  try{
   const acquired=(await lock.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) locked',['payout:'+job.id])).rows[0].locked;if(!acquired)continue;
   const reserve=(await loadKeys(job.intent_id)).collector;if(!reserve)throw new Error('Project collector is unavailable.');
   const signer=new DevnetPayoutSigner(connection,new PostgresPayoutStore(payer.publicKey.toBase58()),{enabled:true,reserve,feePayer:payer,maxPayoutLamports:10_000_000_000n,minFeePayerBalanceLamports:1000000n});
   await signer.prepare(job.id);const status=await signer.broadcast(job.id);
   if(status.state==='finalized')await transaction(async c=>{
    const claim=(await c.query('SELECT * FROM claims WHERE id=$1 FOR UPDATE',[job.id])).rows[0];if(claim.status==='finalized')return;
    await c.query('SELECT id FROM projects WHERE id=$1 FOR UPDATE',[claim.project_id]);
    await c.query('UPDATE rewards SET reserved=reserved-$3,paid=paid+$3 WHERE project_id=$1 AND wallet=$2',[claim.project_id,claim.wallet,claim.amount]);
    await c.query('UPDATE projects SET custody=custody-$2 WHERE id=$1',[claim.project_id,claim.amount]);
    await postJournal(c,'payout:'+job.id,claim.project_id,[{account:'reward:reserved:'+claim.wallet,amount:-BigInt(claim.amount)},{account:'reward:paid:'+claim.wallet,amount:BigInt(claim.amount)}]);
    await c.query("UPDATE claims SET status='finalized',updated_at=now() WHERE id=$1",[job.id]);await c.query("UPDATE jobs SET status='done' WHERE claim_id=$1",[job.id]);
    await recordActivity(c,claim.project_id,claim.wallet,'payout',BigInt(claim.amount),status.signature);
   });
   else if(status.state==='failed'||(status.state==='unknown'&&status.expired===true))await db.query("UPDATE claims SET status='review',updated_at=now() WHERE id=$1",[job.id]);
  }finally{await lock.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',['payout:'+job.id]);lock.release();}
 }
}
