import type { RewardMode, RewardRecipient } from '../types';
import { mulBps } from './amounts';

export interface AllocationInput {
  amount:bigint;
  mode:RewardMode;
  creator:string;
  balances:Map<string,bigint>;
  excluded:Set<string>;
  recipients?:readonly RewardRecipient[];
  /** Only for pre-Mogz simulator projects preserved during migration. */
  legacyHolderShareBps?:number;
  tradeHistory?:readonly TradeRecord[];
  currentPrice?:PriceRatio;
}
export interface TradeRecord { wallet:string; side:'buy'|'sell'; tokenAmount:bigint; solAmount:bigint; sequence:number; }
export interface PriceRatio { quoteReserve:bigint; tokenReserve:bigint; }
export interface AllocationResult { shares:Map<string,bigint>; distributed:bigint; dust:bigint; eligibleSupply:bigint; winner:string|null; eligibility:Map<string,string>; }
const add=(map:Map<string,bigint>,wallet:string,amount:bigint)=>{if(amount>0n)map.set(wallet,(map.get(wallet)??0n)+amount);};
const eligibleBalances=(input:AllocationInput)=>[...input.balances].filter(([wallet,amount])=>amount>0n&&wallet!==input.creator&&!input.excluded.has(wallet));
function distributeProRata(amount:bigint, entries:readonly [string,bigint][], shares:Map<string,bigint>){
 const total=entries.reduce((sum,[,value])=>sum+value,0n);let distributed=0n;
 if(total>0n)for(const [wallet,balance] of entries){const piece=amount*balance/total;add(shares,wallet,piece);distributed+=piece;}
 return {distributed,total};
}
function historyByWallet(history:readonly TradeRecord[]){
 const records=new Map<string,TradeRecord[]>();for(const trade of history){const existing=records.get(trade.wallet)??[];existing.push(trade);records.set(trade.wallet,existing);}return records;
}
function underwaterEligible(input:AllocationInput, entries:readonly [string,bigint][], reasons:Map<string,string>){
 const histories=historyByWallet(input.tradeHistory??[]);const current=input.currentPrice;
 if(!current||current.quoteReserve<=0n||current.tokenReserve<=0n)return [] as [string,bigint][];
 const winners:[string,bigint][]=[];
 for(const [wallet,balance] of entries){
  const history=histories.get(wallet)??[];let bought=0n, spent=0n, sold=0n;
  for(const trade of history){if(trade.side==='buy'){bought+=trade.tokenAmount;spent+=trade.solAmount;}else sold+=trade.tokenAmount;}
  if(bought===0n||sold>=bought){reasons.set(wallet,'No qualifying open purchase history.');continue;}
  // `spent / bought` is average entry. Compare fractions without floating point: entry > current price.
  if(spent*current.tokenReserve>current.quoteReserve*bought){winners.push([wallet,balance]);reasons.set(wallet,'Average entry is above the current curve price.');}
  else reasons.set(wallet,'Average entry is no longer above the current curve price.');
 }
 return winners;
}
export function allocateRewards(input:AllocationInput):AllocationResult {
 if(input.amount<0n)throw new Error('Reward amount cannot be negative.');
 if([...input.balances.values()].some(amount=>amount<0n))throw new Error('Snapshot balances cannot be negative.');
 const shares=new Map<string,bigint>(),eligibility=new Map<string,string>();
 const entries=eligibleBalances(input);const eligibleSupply=entries.reduce((sum,[,amount])=>sum+amount,0n);
 let distributed=0n;let winner:string|null=null;
 switch(input.mode){
  case 'creator': add(shares,input.creator,input.amount);distributed=input.amount;break;
  case 'holders': { const result=distributeProRata(input.amount,entries,shares);distributed=result.distributed;break; }
  case 'legacy_split': {
   const holderBudget=mulBps(input.amount,input.legacyHolderShareBps??0);
   add(shares,input.creator,input.amount-holderBudget);
   const result=distributeProRata(holderBudget,entries,shares);
   distributed=(input.amount-holderBudget)+result.distributed;
   break;
  }
  case 'share': {
   const recipients=input.recipients??[];const total=recipients.reduce((sum,r)=>sum+r.shareBps,0);
   if(!recipients.length||total!==10000)throw new Error('Share recipients must total exactly 100%.');
   for(const recipient of recipients)add(shares,recipient.wallet,mulBps(input.amount,recipient.shareBps));
   distributed=input.amount;break;
  }
  case 'king_of_hill': {
   const histories=historyByWallet(input.tradeHistory??[]);
   const candidates=entries.flatMap(([wallet])=>{
    const history=histories.get(wallet)??[];const buys=history.filter(t=>t.side==='buy');const sells=history.filter(t=>t.side==='sell');
    if(sells.length>0||buys.length===0){eligibility.set(wallet,'A sale disqualifies this wallet; transfers are not simulated.');return [] as {wallet:string;buy:TradeRecord}[];}
    const highest=buys.reduce((best,t)=>t.solAmount>best.solAmount||t.solAmount===best.solAmount&&t.sequence<best.sequence?t:best,buys[0]);
    eligibility.set(wallet,'Largest qualifying single buy.');return [{wallet,buy:highest}];
   });
   const selected=candidates.sort((a,b)=>a.buy.solAmount===b.buy.solAmount?a.buy.sequence-b.buy.sequence:a.buy.solAmount>b.buy.solAmount?-1:1)[0];
   if(selected){add(shares,selected.wallet,input.amount);distributed=input.amount;winner=selected.wallet;}
   break;
  }
  case 'underwater': {const candidates=underwaterEligible(input,entries,eligibility);const result=distributeProRata(input.amount,candidates,shares);distributed=result.distributed;break;}
  case 'cto_on_creator_sell': throw new Error('CTO must resolve to Creator or Holders before allocation.');
  default: {const exhaustive:never=input.mode;throw new Error(`Unsupported reward mode: ${exhaustive}`);}
 }
 return {shares,distributed,dust:input.amount-distributed,eligibleSupply,winner,eligibility};
}
