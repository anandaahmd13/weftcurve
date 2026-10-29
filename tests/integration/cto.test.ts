import { beforeAll,afterAll,it,expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db } from '../../src/server/db/client';
import { migrate } from '../../src/server/db/migrate';
import { createProject,trade,distribute } from '../../src/server/service';
const creator='sim:cto-creator-'+randomUUID();const holder='sim:cto-holder-'+randomUUID();
beforeAll(async()=>{await migrate();for(const wallet of [creator,holder])await db.query('INSERT INTO wallets(address,label) VALUES($1,$1)',[wallet]);});
afterAll(()=>db.end());
it('permanently redirects later destination fees to holders after the original creator sells',async()=>{
 const {project}=await createProject(creator,randomUUID(),{name:'CTO Test',symbol:'CTO',description:'',mode:'cto_on_creator_sell',recipients:[]});
 await trade(creator,randomUUID(),project.id,{side:'buy',amount:'0.5'});
 await distribute(creator,randomUUID(),project.id);
 const creatorBefore=(await db.query('SELECT available FROM rewards WHERE project_id=$1 AND wallet=$2',[project.id,creator])).rows[0].available;
 await trade(holder,randomUUID(),project.id,{side:'buy',amount:'0.25'});
 await trade(creator,randomUUID(),project.id,{side:'sell',amount:'100000'});
 await trade(holder,randomUUID(),project.id,{side:'buy',amount:'0.1'});
 const p=(await db.query('SELECT * FROM projects WHERE id=$1',[project.id])).rows[0];
 expect(p.cto_active).toBe(true);expect(p.cto_triggered_at).not.toBeNull();
 await distribute(holder,randomUUID(),project.id);
 const creatorAfter=(await db.query('SELECT available FROM rewards WHERE project_id=$1 AND wallet=$2',[project.id,creator])).rows[0].available;
 const holderAfter=(await db.query('SELECT available FROM rewards WHERE project_id=$1 AND wallet=$2',[project.id,holder])).rows[0].available;
 // The holder buy happened before the trigger, so its accrued destination fee stays Creator-side.
 expect(BigInt(creatorAfter)).toBe(BigInt(creatorBefore)+750000n);
 expect(BigInt(holderAfter)).toBeGreaterThan(0n);
 expect((await db.query("SELECT count(*) FROM activity WHERE project_id=$1 AND type='cto_trigger'",[project.id])).rows[0].count).toBe('1');
});
