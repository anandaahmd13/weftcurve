import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { Connection,Keypair,PublicKey } from '@solana/web3.js';
import { z } from 'zod';
import { MeteoraDevnetAdapter, type LaunchIntent } from '../adapters/meteora/client';
import { network,origin } from './config';
import { db,transaction } from './db/client';
import { idempotent,projectFromRow } from './service';
import { parseUnits } from '../domain/rewards/amounts';
export function devnetConnection(){return new Connection(process.env.SOLANA_RPC_URL??'https://api.devnet.solana.com','finalized');}
export function devnetEnabled(){return network==='devnet'&&process.env.ENABLE_DEVNET_TRANSACTIONS==='true'&&Boolean(process.env.DEVNET_PARTNER_PUBLIC_KEY)&&Boolean(process.env.DEVNET_KEYS_DIR);}
function guard(){if(!devnetEnabled())throw new Error('Devnet is not configured. Set up the test collector and fee payer first.');}
function keyDirectory(){const d=process.env.DEVNET_KEYS_DIR;if(!d)throw new Error('DEVNET_KEYS_DIR is required.');return resolve(d);}
export async function loadKeys(id:string){if(!/^[a-f0-9-]{36}$/.test(id))throw new Error('Invalid launch intent.');const data=JSON.parse(await readFile(join(keyDirectory(),id+'.json'),'utf8')) as {mint:number[];config:number[];collector?:number[]};return {mint:Keypair.fromSecretKey(Uint8Array.from(data.mint)),config:Keypair.fromSecretKey(Uint8Array.from(data.config)),collector:data.collector?Keypair.fromSecretKey(Uint8Array.from(data.collector)):undefined};}
export async function loadIntent(id:string):Promise<LaunchIntent|null>{const row=(await db.query("SELECT intent FROM launch_intents WHERE id=$1 AND status IN ('authorized','active')",[id])).rows[0];return row?.intent??null;}
export function adapter(){return new MeteoraDevnetAdapter(devnetConnection(),{enabled:devnetEnabled(),loadLaunchIntent:loadIntent});}
const recipientSchema=z.object({id:z.string().uuid(),label:z.string().trim().min(2).max(64),kind:z.enum(['wallet','charity']),wallet:z.string().trim().min(3).max(100),shareBps:z.number().int().min(1).max(10000)});
const launchSchema=z.object({name:z.string().trim().min(2).max(32),symbol:z.string().trim().regex(/^[A-Za-z0-9]{2,10}$/),description:z.string().max(500),image:z.string().max(280000).nullable().optional(),mode:z.enum(['creator','holders','king_of_hill','underwater','share','cto_on_creator_sell']),holderShareBps:z.literal(0),recipients:recipientSchema.array().max(100).default([])});
export async function prepareDevnetLaunch(wallet:string,key:string,input:unknown){
 guard();const p=launchSchema.parse(input);const share=0;
 if(p.mode!=='creator')throw new Error('This destination is simulator-only until verified distribution infrastructure is enabled.');
 if(p.recipients.length)throw new Error('Only Share mode may include recipients, and Share is simulator-only on devnet.');
 if(p.image&&!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(p.image))throw new Error('Unsupported image format.');
 const saved=await idempotent(wallet,key,'devnet-launch',p,async c=>{
  const id=randomUUID();const mint=Keypair.generate();const config=Keypair.generate();const collector=p.mode==='creator'?undefined:Keypair.generate();
  const partner=new PublicKey(process.env.DEVNET_PARTNER_PUBLIC_KEY!).toBase58();
  const intent:LaunchIntent={id,network:'devnet',status:'authorized',mode:p.mode,holderShareBps:share,recipients:p.recipients,originalCreator:wallet,payer:wallet,poolCreator:collector?.publicKey.toBase58()??wallet,partnerFeeClaimer:partner,leftoverReceiver:partner,mint:mint.publicKey.toBase58(),config:config.publicKey.toBase58(),name:p.name,symbol:p.symbol.toUpperCase(),uri:`${origin}/api/metadata/${id}`};
  await mkdir(keyDirectory(),{recursive:true,mode:0o700});
  await writeFile(join(keyDirectory(),id+'.json'),JSON.stringify({mint:[...mint.secretKey],config:[...config.secretKey],collector:collector?[...collector.secretKey]:undefined}),{flag:'wx',mode:0o600});
  await c.query('INSERT INTO launch_intents(id,wallet,intent,metadata) VALUES($1,$2,$3,$4)',[id,wallet,JSON.stringify(intent),JSON.stringify({name:p.name,symbol:intent.symbol,description:p.description,image:p.image??null})]);return {intentId:id};
 });
 const row=(await db.query('SELECT prepared FROM launch_intents WHERE id=$1',[saved.intentId])).rows[0];
 if(row.prepared)return {...row.prepared,intentId:saved.intentId};
 const prepared=await adapter().prepareLaunch(saved.intentId,await loadKeys(saved.intentId));
 await db.query('UPDATE launch_intents SET prepared=$2 WHERE id=$1 AND prepared IS NULL',[saved.intentId,JSON.stringify(prepared)]);
 return {...(await db.query('SELECT prepared FROM launch_intents WHERE id=$1',[saved.intentId])).rows[0].prepared,intentId:saved.intentId};
}
export async function confirmDevnetLaunch(wallet:string,intentId:string){
 guard();const record=(await db.query('SELECT * FROM launch_intents WHERE id=$1 AND wallet=$2',[intentId,wallet])).rows[0];if(!record)throw new Error('Launch intent not found.');
 const verified=await adapter().verifyLaunch(intentId);const intent=record.intent as LaunchIntent;
 return transaction(async c=>{
  const policy=JSON.stringify({mode:intent.mode,recipients:intent.recipients,creator:wallet});
  const {createHash}=await import('node:crypto');
  const result=await c.query(`INSERT INTO projects(id,mint,network,name,symbol,description,image,mode,holder_share_bps,recipients,creator,policy_hash) VALUES($1,$1,'devnet',$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(id) DO UPDATE SET name=projects.name RETURNING *`,[intent.mint,intent.name,intent.symbol,record.metadata.description,record.metadata.image,intent.mode,intent.holderShareBps,JSON.stringify(intent.recipients),wallet,createHash('sha256').update(policy).digest('hex')]);
  await c.query('INSERT INTO chain_projects(project_id,intent_id,pool,config,collector) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[intent.mint,intentId,verified.address.toBase58(),intent.config,intent.poolCreator]);
  await c.query("UPDATE launch_intents SET status='active' WHERE id=$1",[intentId]);return {project:projectFromRow(result.rows[0])};
 });
}
export async function prepareDevnetTrade(wallet:string,key:string,input:unknown){
 guard();const p=z.object({projectId:z.string(),side:z.enum(['buy','sell']),amount:z.string(),slippageBps:z.number().int().min(0).max(1000)}).parse(input);
 const record=(await db.query('SELECT c.*,p.status FROM chain_projects c JOIN projects p ON p.id=c.project_id WHERE p.id=$1 AND p.network=$2',[p.projectId,'devnet'])).rows[0];if(!record)throw new Error('Devnet pool not found.');
 const amount=parseUnits(p.amount,p.side==='buy'?9:6);const a=adapter();const pool=new PublicKey(record.damm_pool??record.pool);const isDamm=Boolean(record.damm_pool);const sell=p.side==='sell';
 const q=isDamm?await a.quoteDammSwap(pool,amount,sell,p.slippageBps):await a.quoteCurveSwap(pool,amount,sell,p.slippageBps);
 const quote=q.quote as unknown as {minimumAmountOut?:{toString():string};minimumSwapOutAmount?:{toString():string}};
 const min=quote.minimumAmountOut??quote.minimumSwapOutAmount;if(!min)throw new Error('Minimum output is unavailable for this quote.');
 const txInput={pool,owner:new PublicKey(wallet),amountIn:amount,minimumAmountOut:BigInt(min.toString()),swapBaseForQuote:sell,expiresAt:q.expiresAt};
 const prepared=isDamm?await a.prepareDammSwap(txInput):await a.prepareCurveSwap(txInput);
 return idempotent(wallet,key,'devnet-trade',p,async c=>{const id=randomUUID();await c.query('INSERT INTO chain_requests(id,wallet,project_id,kind,prepared) VALUES($1,$2,$3,$4,$5)',[id,wallet,p.projectId,'swap',JSON.stringify(prepared)]);return {...prepared,requestId:id};});
}
