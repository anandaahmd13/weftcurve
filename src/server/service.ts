import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import type { Project, AppState, Claim, RewardMode, RewardRecipient } from '../domain/types';
import { db, transaction } from './db/client';
import { network, assertSimulator } from './config';
import { parseUnits, MIN_CLAIM, mulBps } from '../domain/rewards/amounts';
import { allocateRewards, type TradeRecord } from '../domain/rewards/allocation';
import { postJournal } from '../domain/rewards/ledger';
import { quoteTrade, THRESHOLD } from '../adapters/simulator/curve';
export const personas = { creator:{address:'sim:creator',label:'Demo creator'}, 'holder-a':{address:'sim:holder-a',label:'Holder A'}, 'holder-b':{address:'sim:holder-b',label:'Holder B'} } as const;
type Row=Record<string, unknown>;
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const recipientSchema=z.object({id:z.string().uuid(),label:z.string().trim().min(2).max(64),kind:z.enum(['wallet','charity']),wallet:z.string().trim().min(3).max(100),shareBps:z.number().int().min(1).max(10000)});
const modeSchema=z.enum(['creator','holders','king_of_hill','underwater','share','cto_on_creator_sell']);
function recipientsFromRow(value:unknown):RewardRecipient[]{return recipientSchema.array().safeParse(value).data??[];}
export function projectFromRow(r:Row):Project {
 return {id:String(r.id),mint:String(r.mint),name:String(r.name),symbol:String(r.symbol),description:String(r.description),image:r.image?String(r.image):null,mode:r.mode as RewardMode,holderShareBps:Number(r.holder_share_bps),recipients:recipientsFromRow(r.recipients),ctoActive:Boolean(r.cto_active),ctoTriggeredAt:r.cto_triggered_at?new Date(r.cto_triggered_at as string).toISOString():null,creator:String(r.creator),network:r.network as Project['network'],status:r.status as Project['status'],createdAt:new Date(r.created_at as string).toISOString(),supply:String(r.supply),reserve:String(r.reserve),volume:String(r.volume),creatorFees:String(r.creator_fees),distributed:String(r.distributed),holderCount:Number(r.holder_count??0),tokenReserve:String(r.token_reserve),policyHash:String(r.policy_hash)};
}
export async function state(wallet:string|null,csrf:string|null):Promise<AppState> {
 const projects=await db.query(`SELECT p.*, (SELECT count(*) FROM holdings h WHERE h.project_id=p.id AND h.amount>0 AND h.wallet<>p.creator) holder_count FROM projects p WHERE network=$1 ORDER BY created_at DESC`,[network]);
 const rewards=wallet?await db.query('SELECT * FROM rewards WHERE wallet=$1',[wallet]):{rows:[]};
 const claims=wallet?await db.query('SELECT * FROM claims WHERE wallet=$1 ORDER BY created_at DESC LIMIT 50',[wallet]):{rows:[]};
 const activity=await db.query('SELECT a.* FROM activity a JOIN projects p ON p.id=a.project_id WHERE p.network=$1 ORDER BY a.created_at DESC LIMIT 100',[network]);
 const holdings=wallet?await db.query('SELECT * FROM holdings WHERE wallet=$1',[wallet]):{rows:[]};
 const user=wallet?(await db.query('SELECT * FROM wallets WHERE address=$1',[wallet])).rows[0]:null;
 const health=(await db.query('SELECT * FROM worker_health WHERE id=1')).rows[0];
 const pending=(await db.query("SELECT count(*) FROM jobs WHERE status<>'done'")).rows[0];
 const chainReady=network==='devnet'&&process.env.ENABLE_DEVNET_TRANSACTIONS==='true'&&Boolean(process.env.DEVNET_PARTNER_PUBLIC_KEY)&&Boolean(process.env.DEVNET_KEYS_DIR);
 const rewardsReady=chainReady&&process.env.ENABLE_DEVNET_REWARDS==='true'&&Boolean(process.env.DEVNET_FEE_PAYER_FILE);
 return {network,wallet,walletLabel:Object.values(personas).find(p=>p.address===wallet)?.label??user?.label??(wallet?'Devnet wallet':null),csrf,projects:projects.rows.map(projectFromRow),rewards:rewards.rows.map(r=>({projectId:r.project_id,available:r.available,reserved:r.reserved,paid:r.paid})),claims:claims.rows.map(claimFromRow),activity:activity.rows.map(r=>({id:r.id,projectId:r.project_id,wallet:r.wallet,type:r.type,amount:r.amount,signature:r.signature,createdAt:new Date(r.created_at).toISOString()})),holdings:Object.fromEntries(holdings.rows.map(r=>[r.project_id,r.amount])),balance:user?.balance??'0',worker:{lastRun:health?.last_run?.toISOString()??null,pending:Number(pending.count)},capabilities:{launch:network==='simulator'||chainReady,trade:network==='simulator'||chainReady,claim:network==='simulator'||rewardsReady,reason:network==='devnet'&&!chainReady?'Devnet transactions are disabled. Configure the collector and fee payer, then verify the deployment.':network==='devnet'&&!rewardsReady?'Devnet launches are available; payouts are not configured yet.':null}};
}
export function claimFromRow(r:Row):Claim {return {id:String(r.id),projectId:String(r.project_id),wallet:String(r.wallet),amount:String(r.amount),status:r.status as Claim['status'],signature:r.signature?String(r.signature):null,createdAt:new Date(r.created_at as string).toISOString()};}
export async function idempotent<T>(wallet:string,key:string,kind:string,payload:unknown,fn:(c:PoolClient)=>Promise<T>):Promise<T>{
 if(!/^[a-zA-Z0-9_-]{8,100}$/.test(key))throw new Error('Idempotency-Key is required.');
 return transaction(async c=>{await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[wallet+':'+key]);const previous=(await c.query('SELECT * FROM operations WHERE wallet=$1 AND key=$2',[wallet,key])).rows[0];const payloadHash=hash(payload);if(previous){if(previous.kind!==kind||previous.payload_hash!==payloadHash)throw new Error('This Idempotency-Key has already been used for a different action.');return previous.response as T;}const result=await fn(c);await c.query('INSERT INTO operations(wallet,key,kind,payload_hash,response) VALUES($1,$2,$3,$4,$5)',[wallet,key,kind,payloadHash,JSON.stringify(result)]);return result;});
}
const projectSchema=z.object({name:z.string().trim().min(2).max(32),symbol:z.string().trim().regex(/^[a-zA-Z0-9]{2,10}$/).transform(s=>s.toUpperCase()),description:z.string().trim().max(500),image:z.string().max(280000).nullable().optional(),mode:modeSchema,recipients:recipientSchema.array().max(100).default([]),holderShareBps:z.number().int().min(0).max(10000).optional()});
const simulatorCharities:Record<string,string>={
 'Open Source Collective':'simulator:open-source-collective',
 'Community Food Bank':'simulator:community-food-bank',
 'Ocean Cleanup Fund':'simulator:ocean-cleanup-fund',
};
function isWalletDestination(value:string,networkName:string){return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)||networkName==='simulator'&&Object.values(personas).some(p=>p.address===value);}
function validatePolicy(mode:RewardMode,recipients:RewardRecipient[],networkName:string){
 if(mode==='share'){
  if(!recipients.length)throw new Error('Share mode needs at least one recipient.');
  if(recipients.reduce((sum,r)=>sum+r.shareBps,0)!==10000)throw new Error('Share recipients must total exactly 100%.');
  if(recipients.filter(r=>r.kind==='charity').length>5)throw new Error('Share mode supports at most five charity recipients.');
  const seen=new Set<string>();for(const recipient of recipients){
   if(seen.has(recipient.wallet))throw new Error('Each share recipient must be unique.');seen.add(recipient.wallet);
   if(recipient.kind==='wallet'&&!isWalletDestination(recipient.wallet,networkName))throw new Error('Wallet recipient address is invalid.');
   if(recipient.kind==='charity'&&(networkName!=='simulator'||simulatorCharities[recipient.label]!==recipient.wallet))throw new Error('Charity recipients are simulator-only fixed test destinations until a verified donation integration exists.');
  }
 } else if(recipients.length)throw new Error('Recipients only apply to Share mode.');
}
export async function createProject(wallet:string,key:string,input:unknown){
 assertSimulator();const p=projectSchema.parse(input);const recipients=p.recipients as RewardRecipient[];validatePolicy(p.mode,recipients,network);
 if(p.image&&!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(p.image))throw new Error('Image must be a PNG, JPEG, or WebP file.');
 return idempotent(wallet,key,'launch',p,async c=>{const id='sim-'+randomUUID();const policyHash=hash({mode:p.mode,recipients,creator:wallet,epoch:300,version:2});const r=await c.query(`INSERT INTO projects(id,mint,network,name,symbol,description,image,mode,holder_share_bps,recipients,creator,policy_hash) VALUES($1,$1,'simulator',$2,$3,$4,$5,$6,0,$7,$8,$9) RETURNING *`,[id,p.name,p.symbol,p.description,p.image??null,p.mode,JSON.stringify(recipients),wallet,policyHash]);await recordActivity(c,id,wallet,'launch',0n);return {project:projectFromRow(r.rows[0])};});
}
export async function recordActivity(c:PoolClient,project:string,wallet:string,type:string,amount:bigint,signature:string|null=null){await c.query('INSERT INTO activity(id,project_id,wallet,type,amount,signature) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),project,wallet,type,amount.toString(),signature]);}
export async function trade(wallet:string,key:string,projectId:string,input:unknown){
 assertSimulator();const {side,amount}=z.object({side:z.enum(['buy','sell']),amount:z.string()}).parse(input);const raw=parseUnits(amount,side==='buy'?9:6);
 return idempotent(wallet,key,'trade:'+projectId,{side,amount},async c=>{
  const p=(await c.query("SELECT * FROM projects WHERE id=$1 AND network='simulator' FOR UPDATE",[projectId])).rows[0];if(!p)throw new Error('Token not found.');if(p.status==='migration_pending')throw new Error('Migration must finish before trading can resume.');
  const user=(await c.query('SELECT * FROM wallets WHERE address=$1 FOR UPDATE',[wallet])).rows[0];if(!user)throw new Error('Simulator identity is unavailable.');const holding=(await c.query('SELECT amount FROM holdings WHERE project_id=$1 AND wallet=$2',[projectId,wallet])).rows[0];const held=BigInt(holding?.amount??0);
  const q=quoteTrade(side,raw,BigInt(p.reserve),BigInt(p.token_reserve),p.status==='graduated');if(BigInt(user.balance)<q.solIn||held<q.tokensIn)throw new Error('Insufficient balance.');
  const protocol=mulBps(q.fee,2000),netFee=q.fee-protocol,creatorFee=mulBps(netFee,p.status==='graduated'?5000:7500),platform=netFee-creatorFee,id='sim-fee-'+randomUUID();
  const ctoTrigger=p.mode==='cto_on_creator_sell'&&!p.cto_active&&side==='sell'&&wallet===p.creator;
  // Lock historical creator-mode fees to the creator before current sell activates holder rewards.
  if(ctoTrigger)await distributeProject(c,projectId);
  await c.query('UPDATE wallets SET balance=balance+$2 WHERE address=$1',[wallet,(q.solOut-q.solIn).toString()]);await c.query('INSERT INTO holdings(project_id,wallet,amount) VALUES($1,$2,$3) ON CONFLICT(project_id,wallet) DO UPDATE SET amount=EXCLUDED.amount',[projectId,wallet,(held+q.tokensOut-q.tokensIn).toString()]);
  const status=p.status==='graduated'?'graduated':q.newReserve>=THRESHOLD?'migration_pending':'bonding',volume=side==='buy'?q.solIn:q.solOut+q.fee;
  await c.query('UPDATE projects SET reserve=$2,token_reserve=$3,volume=volume+$4,creator_fees=creator_fees+$5,undistributed=undistributed+$5,custody=custody+$5,status=$6,cto_active=cto_active OR $7,cto_triggered_at=CASE WHEN $7 THEN now() ELSE cto_triggered_at END WHERE id=$1',[projectId,q.newReserve.toString(),q.newTokenReserve.toString(),volume.toString(),creatorFee.toString(),status,ctoTrigger]);
  await c.query('INSERT INTO trade_lots(project_id,wallet,side,token_amount,sol_amount) VALUES($1,$2,$3,$4,$5)',[projectId,wallet,side,(side==='buy'?q.tokensOut:q.tokensIn).toString(),volume.toString()]);
  if(creatorFee>0n)await c.query('INSERT INTO receipts(id,project_id,source,amount) VALUES($1,$2,$3,$4)',[id,projectId,p.status==='graduated'?'sim-damm':'sim-dbc',creatorFee.toString()]);
  await postJournal(c,id,projectId,[{account:'fee:traders',amount:-q.fee},{account:'fee:protocol',amount:protocol},{account:'fee:platform',amount:platform},{account:'reward:undistributed',amount:creatorFee}]);await recordActivity(c,projectId,wallet,side,volume,'sim-trade-'+randomUUID());if(ctoTrigger)await recordActivity(c,projectId,wallet,'cto_trigger',0n,'sim-cto-'+randomUUID());return {executed:true,solAmount:volume.toString(),tokenAmount:(side==='buy'?q.tokensOut:q.tokensIn).toString(),ctoTriggered:ctoTrigger};
 });
}
async function allocationInput(c:PoolClient,p:Row){
 const holdings=(await c.query('SELECT wallet,amount FROM holdings WHERE project_id=$1',[p.id])).rows;const balances=new Map<string,bigint>(holdings.map(r=>[r.wallet,BigInt(r.amount)]));
 const trades=(await c.query('SELECT wallet,side,token_amount,sol_amount,id FROM trade_lots WHERE project_id=$1 ORDER BY id',[p.id])).rows.map((r,index):TradeRecord=>({wallet:r.wallet,side:r.side,tokenAmount:BigInt(r.token_amount),solAmount:BigInt(r.sol_amount),sequence:index}));
 return {balances,trades};
}
export async function distributeProject(c:PoolClient,projectId:string){
 const p=(await c.query("SELECT * FROM projects WHERE id=$1 AND network='simulator' FOR UPDATE",[projectId])).rows[0];if(!p)return {distributed:'0'};const amount=BigInt(p.undistributed);if(amount===0n)return {distributed:'0'};const {balances,trades}=await allocationInput(c,p);const recipients=recipientsFromRow(p.recipients);
 const effectiveMode=p.mode==='cto_on_creator_sell'?(p.cto_active?'holders':'creator'):p.mode;
 const allocation=allocateRewards({amount,mode:effectiveMode,creator:p.creator,balances,excluded:new Set(),recipients,legacyHolderShareBps:p.mode==='legacy_split'?Number(p.holder_share_bps):undefined,tradeHistory:trades,currentPrice:{quoteReserve:BigInt(p.reserve)+333_333_334n,tokenReserve:BigInt(p.token_reserve)}});
 const epoch=randomUUID();const snapshot={balances:[...balances].map(([wallet,value])=>({wallet,amount:value.toString()})),trades:trades.map(t=>({...t,tokenAmount:t.tokenAmount.toString(),solAmount:t.solAmount.toString()})),winner:allocation.winner,eligibility:[...allocation.eligibility]};
 await c.query('INSERT INTO epochs(id,project_id,policy_hash,snapshot,amount,distributed,dust) VALUES($1,$2,$3,$4,$5,$6,$7)',[epoch,projectId,p.policy_hash,JSON.stringify(snapshot),amount.toString(),allocation.distributed.toString(),allocation.dust.toString()]);const entries=[{account:'reward:undistributed',amount:-allocation.distributed}];
 for(const [owner,value] of allocation.shares){
  // Charity destinations are simulator ledger labels only. They never trigger an external payout or claim.
  if(owner.startsWith('simulator:')){entries.push({account:'reward:simulated-charity:'+owner,amount:value});continue;}
  await c.query('INSERT INTO rewards(project_id,wallet,available) VALUES($1,$2,$3) ON CONFLICT(project_id,wallet) DO UPDATE SET available=rewards.available+EXCLUDED.available',[projectId,owner,value.toString()]);entries.push({account:'reward:available:'+owner,amount:value});
 }
 if(allocation.distributed>0n)await postJournal(c,'epoch:'+epoch,projectId,entries);await c.query('UPDATE receipts SET epoch_id=$2 WHERE project_id=$1 AND epoch_id IS NULL',[projectId,epoch]);await c.query('UPDATE projects SET undistributed=$2,holder_carry=0,distributed=distributed+$3,last_epoch=now() WHERE id=$1',[projectId,allocation.dust.toString(),allocation.distributed.toString()]);await recordActivity(c,projectId,'sim:worker','distribution',allocation.distributed);return {distributed:allocation.distributed.toString(),winner:allocation.winner};
}
export async function distribute(wallet:string,key:string,projectId:string){assertSimulator();return idempotent(wallet,key,'distribute:'+projectId,{},c=>distributeProject(c,projectId));}
export async function migrateProject(wallet:string,key:string,projectId:string){assertSimulator();return idempotent(wallet,key,'migrate:'+projectId,{},async c=>{const p=(await c.query("SELECT * FROM projects WHERE id=$1 AND network='simulator' FOR UPDATE",[projectId])).rows[0];if(!p||p.status!=='migration_pending')throw new Error('The bonding curve is not ready for migration.');await c.query("UPDATE projects SET status='graduated' WHERE id=$1",[projectId]);await recordActivity(c,projectId,wallet,'migration',0n);return {migrated:true};});}
export async function claimReward(wallet:string,key:string,projectId:string){
 if(network==='devnet'&&process.env.ENABLE_DEVNET_REWARDS!=='true')throw new Error('Devnet payouts are not enabled.');return idempotent(wallet,key,'claim:'+projectId,{},async c=>{const p=(await c.query('SELECT * FROM projects WHERE id=$1 AND network=$2 FOR UPDATE',[projectId,network])).rows[0];if(!p)throw new Error('Token not found.');const r=(await c.query('SELECT * FROM rewards WHERE project_id=$1 AND wallet=$2 FOR UPDATE',[projectId,wallet])).rows[0];const amount=BigInt(r?.available??0);if(amount<MIN_CLAIM)throw new Error(`Minimum claim is 0.001 ${network==='simulator'?'simulated':'devnet'} SOL.`);const liability=(await c.query('SELECT coalesce(sum(available+reserved),0) total FROM rewards WHERE project_id=$1',[projectId])).rows[0];if(BigInt(p.custody)<BigInt(liability.total)+BigInt(p.undistributed))throw new Error('Insufficient reserves. Payouts are paused for reconciliation.');const id=randomUUID();await c.query('UPDATE rewards SET available=available-$3,reserved=reserved+$3 WHERE project_id=$1 AND wallet=$2',[projectId,wallet,amount.toString()]);const row=(await c.query("INSERT INTO claims(id,project_id,wallet,amount,status) VALUES($1,$2,$3,$4,'reserved') RETURNING *",[id,projectId,wallet,amount.toString()])).rows[0];await c.query('INSERT INTO jobs(id,claim_id) VALUES($1,$1)',[id]);await postJournal(c,'reserve:'+id,projectId,[{account:'reward:available:'+wallet,amount:-amount},{account:'reward:reserved:'+wallet,amount}]);await recordActivity(c,projectId,wallet,'claim',amount);return {claim:claimFromRow(row)};});
}
