import { PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { adapter, devnetConnection } from './devnet';
import { db,transaction } from './db/client';
export async function syncDevnetProject(projectId:string,wallet?:string){
 const record=(await db.query('SELECT c.*,p.creator FROM chain_projects c JOIN projects p ON p.id=c.project_id WHERE p.id=$1 AND p.network=$2',[projectId,'devnet'])).rows[0];if(!record)throw new Error('Devnet project not found.');
 const a=adapter();const {pool,config}=await a.readCurve(new PublicKey(record.pool));
 let status='bonding';
 if(pool.poolState.quoteReserve.gte(config.migrationQuoteThreshold))status='migration_pending';
 if(record.damm_pool){await a.readDamm(new PublicKey(record.damm_pool));status='graduated';}
 const rpc=devnetConnection();
 let balance:bigint|null=null;let holding:bigint|null=null;
 if(wallet){
  const raw=await rpc.getBalance(new PublicKey(wallet),'finalized');if(!Number.isSafeInteger(raw))throw new Error('Unable to read the balance precisely.');balance=BigInt(raw);
  const accounts=await rpc.getParsedTokenAccountsByOwner(new PublicKey(wallet),{mint:new PublicKey(projectId)},'finalized');
  holding=accounts.value.reduce((sum,a)=>sum+BigInt(a.account.data.parsed.info.tokenAmount.amount),0n);
 }
 await transaction(async c=>{
  await c.query('UPDATE projects SET reserve=$2,token_reserve=$3,status=$4 WHERE id=$1',[projectId,pool.poolState.quoteReserve.toString(),pool.poolState.baseReserve.toString(),status]);
  if(wallet&&balance!==null){await c.query('INSERT INTO wallets(address,label,balance) VALUES($1,$1,$2) ON CONFLICT(address) DO UPDATE SET balance=EXCLUDED.balance',[wallet,balance.toString()]);await c.query('INSERT INTO holdings(project_id,wallet,amount) VALUES($1,$2,$3) ON CONFLICT(project_id,wallet) DO UPDATE SET amount=EXCLUDED.amount',[projectId,wallet,holding!.toString()]);}
 });
 return {status,pool:record.pool,collector:record.collector,creator:record.creator,baseVault:pool.poolState.baseVault.toBase58(),quoteVault:pool.poolState.quoteVault.toBase58(),collectorQuoteAta:getAssociatedTokenAddressSync(config.quoteMint,new PublicKey(record.collector),false,TOKEN_PROGRAM_ID).toBase58()};
}
