import { describe,it,expect } from 'vitest';
import { allocateRewards } from '../../src/domain/rewards/allocation';
import { parseUnits,formatUnits,mulBps } from '../../src/domain/rewards/amounts';
import { quoteTrade } from '../../src/adapters/simulator/curve';
const base={creator:'creator',balances:new Map([['a',1n],['b',2n],['creator',500n],['pool',1000n]]),excluded:new Set(['pool'])};
describe('exact amounts',()=>{
 it('parses units without float',()=>{expect(parseUnits('123456789.000000001',9)).toBe(123456789000000001n);expect(formatUnits(1000000001n)).toBe('1.000000001');});
 it.each(['-1','1e3','NaN','Infinity','0','1.0000000001'])('rejects %s',v=>expect(()=>parseUnits(v,9)).toThrow());
 it('fee split conserves total',()=>{const fee=mulBps(1000000000n,50);const protocol=mulBps(fee,2000);const creator=mulBps(fee-protocol,7500);expect(creator).toBe(3000000n);expect(protocol).toBe(1000000n);});
});
describe('Mogz-style allocation modes',()=>{
 it('excludes original creator and pool for holders',()=>{const a=allocateRewards({...base,amount:100n,mode:'holders'});expect(a.shares.get('a')).toBe(33n);expect(a.shares.get('b')).toBe(66n);expect(a.dust).toBe(1n);expect(a.shares.has('creator')).toBe(false);});
 it('routes creator-only',()=>{const a=allocateRewards({...base,amount:100n,mode:'creator'});expect(a.shares.get('creator')).toBe(100n);});
 it('preserves legacy split handling for earlier simulator projects',()=>{const a=allocateRewards({...base,amount:100n,mode:'legacy_split',legacyHolderShareBps:5000});expect(a.shares.get('creator')).toBe(50n);expect(a.distributed+a.dust).toBe(100n);});
 it('allocates explicit wallet shares exactly',()=>{const a=allocateRewards({...base,amount:101n,mode:'share',recipients:[{id:'1',label:'Ops',kind:'wallet',wallet:'ops',shareBps:3333},{id:'2',label:'Charity',kind:'charity',wallet:'charity',shareBps:6667}]});expect(a.shares.get('ops')).toBe(33n);expect(a.shares.get('charity')).toBe(67n);expect(a.dust).toBe(0n);});
 it('rejects recipient lists that are not 100%',()=>expect(()=>allocateRewards({...base,amount:100n,mode:'share',recipients:[{id:'1',label:'Ops',kind:'wallet',wallet:'ops',shareBps:5000}]})).toThrow('exactly 100%'));
 it('pays the largest eligible single buyer; earliest buy wins equal ties',()=>{const a=allocateRewards({...base,amount:100n,mode:'king_of_hill',balances:new Map([['first',10n],['second',10n]]),tradeHistory:[{wallet:'second',side:'buy',tokenAmount:10n,solAmount:5n,sequence:1},{wallet:'first',side:'buy',tokenAmount:10n,solAmount:5n,sequence:0}]});expect(a.winner).toBe('first');expect(a.shares.get('first')).toBe(100n);});
 it('disqualifies King of the Hill after any sale',()=>{const a=allocateRewards({...base,amount:100n,mode:'king_of_hill',balances:new Map([['a',10n],['b',10n]]),tradeHistory:[{wallet:'a',side:'buy',tokenAmount:10n,solAmount:100n,sequence:0},{wallet:'a',side:'sell',tokenAmount:1n,solAmount:10n,sequence:1},{wallet:'b',side:'buy',tokenAmount:10n,solAmount:1n,sequence:2}]});expect(a.winner).toBe('b');expect(a.shares.get('b')).toBe(100n);});
 it('pays underwater holders proportionally only while entry is above price',()=>{const a=allocateRewards({...base,amount:100n,mode:'underwater',balances:new Map([['under',2n],['profit',1n]]),tradeHistory:[{wallet:'under',side:'buy',tokenAmount:2n,solAmount:10n,sequence:0},{wallet:'profit',side:'buy',tokenAmount:1n,solAmount:1n,sequence:1}],currentPrice:{quoteReserve:2n,tokenReserve:1n}});expect(a.shares.get('under')).toBe(100n);expect(a.shares.has('profit')).toBe(false);});
 it('carries all when no eligible holders',()=>{const a=allocateRewards({...base,balances:new Map(),amount:100n,mode:'holders'});expect(a.dust).toBe(100n);});
 it('conserves funds over diverse balances/rounding',()=>{for(let i=1;i<500;i++){const amount=BigInt(i)*99999999999n;const a=allocateRewards({...base,amount,mode:'holders',balances:new Map([['a',BigInt(i)],['b',BigInt(i*7)]])});expect([...a.shares.values()].reduce((s,v)=>s+v,0n)+a.dust).toBe(amount);expect(a.dust>=0n).toBe(true);}});
});
describe('simulator curve',()=>{
 it('buy/sell cannot mint SOL profit from rounding',()=>{const buy=quoteTrade('buy',100000000n,0n,1000000000000000n,false);const sell=quoteTrade('sell',buy.tokensOut,buy.newReserve,buy.newTokenReserve,false);expect(sell.solOut<100000000n).toBe(true);});
 it('rejects exceeding graduation threshold',()=>expect(()=>quoteTrade('buy',2000000000n,0n,1000000000000000n,false)).toThrow());
});
