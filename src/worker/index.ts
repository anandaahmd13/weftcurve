import { tick } from './jobs';
import { processDevnetPayouts } from './devnet-payout';
import { db } from '../server/db/client';
import { migrate } from '../server/db/migrate';
import { network } from '../server/config';
await migrate();
console.log(`Worker active on ${network}. Mainnet is disabled.`);
let stopping=false;
for(const s of ['SIGINT','SIGTERM'])process.on(s,()=>{stopping=true;});
while(!stopping){
 try{await tick();await processDevnetPayouts();}catch(error){console.error('Worker failed; job remains available for reconciliation.',error instanceof Error?error.message:'unknown');}
 await new Promise(resolve=>setTimeout(resolve,1500));
}
await db.end();
