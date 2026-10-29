export const LAMPORTS = 1_000_000_000n;
export const TOKEN_UNIT = 1_000_000n;
export const MIN_CLAIM = 1_000_000n;
export function parseUnits(value:string,decimals:number):bigint {
  if(!/^\d+(?:\.\d+)?$/.test(value) || value.length>40) throw new Error('Invalid amount.');
  const [whole,fraction='']=value.split('.');
  if(fraction.length>decimals)throw new Error(`Use no more than ${decimals} decimal places.`);
  const result=BigInt(whole)*10n**BigInt(decimals)+BigInt(fraction.padEnd(decimals,'0')||'0');
  if(result<=0n || result>10n**25n)throw new Error('Amount is outside the allowed range.');
  return result;
}
export function formatUnits(value:bigint,decimals=9):string {
  const sign=value<0n?'-':'';const v=value<0n?-value:value;const base=10n**BigInt(decimals);
  return sign+(v/base).toString()+((v%base)?'.'+(v%base).toString().padStart(decimals,'0').replace(/0+$/,''):'');
}
export function mulBps(amount:bigint,bps:number):bigint {
  if(amount<0n||!Number.isInteger(bps)||bps<0||bps>10000)throw new Error('Invalid fee allocation.');
  return amount*BigInt(bps)/10000n;
}
export const ceilDiv=(a:bigint,b:bigint)=>(a+b-1n)/b;
