import { ceilDiv, mulBps } from '../../domain/rewards/amounts';
const VIRTUAL_SOL=333_333_334n;
const VIRTUAL_TOKENS=1_000_000_000_000_000n;
export const THRESHOLD=1_000_000_000n;
export function quoteTrade(side:'buy'|'sell',amount:bigint,reserve:bigint,tokenReserve:bigint,graduated:boolean) {
  if(amount<=0n||reserve<0n||tokenReserve<=0n)throw new Error('Invalid pool or amount.');
  const x=reserve+VIRTUAL_SOL;
  const y=tokenReserve;
  if(side==='buy'){
    const fee=mulBps(amount,50);const net=amount-fee;
    if(!graduated&&reserve+net>THRESHOLD)throw new Error('Amount exceeds the graduation threshold. Try a smaller purchase.');
    const out=y-ceilDiv(x*y,x+net);
    if(out<=0n||out>=y)throw new Error('Amount is too small or liquidity is insufficient.');
    return {solIn:amount,solOut:0n,tokensIn:0n,tokensOut:out,fee,newReserve:reserve+net,newTokenReserve:y-out};
  }
  const gross=x-ceilDiv(x*y,y+amount);
  if(gross<=0n)throw new Error('Sell amount is too small to return 1 lamport.');
  if(gross>reserve)throw new Error('Insufficient SOL liquidity.');
  const fee=mulBps(gross,50);
  return {solIn:0n,solOut:gross-fee,tokensIn:amount,tokensOut:0n,fee,newReserve:reserve-gross,newTokenReserve:y+amount};
}
export { VIRTUAL_TOKENS };
