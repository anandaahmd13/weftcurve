import { transaction } from './db/client';
import { assertSimulator } from './config';
import { createProject, distribute, idempotent, personas, recordActivity, trade, migrateProject } from './service';
import { postJournal } from '../domain/rewards/ledger';

const CREATOR = personas.creator.address;
const HOLDER_A = personas['holder-a'].address;
const HOLDER_B = personas['holder-b'].address;
const TEST_BALANCE = 10_000_000_000n;

export async function resetSimulator() {
  assertSimulator();
  await transaction(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended('weftcurve:simulator-reset',0))");
    const ids = (await c.query("SELECT id FROM projects WHERE network='simulator'")).rows.map((row) => row.id as string);
    if (ids.length) {
      await c.query('DELETE FROM jobs WHERE claim_id IN (SELECT id FROM claims WHERE project_id = ANY($1::text[]))', [ids]);
      await c.query('DELETE FROM claims WHERE project_id = ANY($1::text[])', [ids]);
      await c.query('DELETE FROM chain_collections WHERE project_id = ANY($1::text[])', [ids]);
      await c.query('DELETE FROM chain_requests WHERE project_id = ANY($1::text[])', [ids]);
      await c.query('DELETE FROM chain_projects WHERE project_id = ANY($1::text[])', [ids]);
      await c.query('DELETE FROM rewards WHERE project_id = ANY($1::text[])', [ids]);
      await c.query('DELETE FROM activity WHERE project_id = ANY($1::text[])', [ids]);
      await c.query("SELECT set_config('weftcurve.allow_simulator_reset','on',true)");
      await c.query('DELETE FROM journal WHERE project_id = ANY($1::text[])', [ids]);
      await c.query('DELETE FROM epochs WHERE project_id = ANY($1::text[])', [ids]);
      await c.query('DELETE FROM receipts WHERE project_id = ANY($1::text[])', [ids]);
      await c.query('DELETE FROM holdings WHERE project_id = ANY($1::text[])', [ids]);
      await c.query('DELETE FROM trade_lots WHERE project_id = ANY($1::text[])', [ids]);
      await c.query("DELETE FROM projects WHERE network='simulator'");
    }
    await c.query("DELETE FROM operations WHERE wallet LIKE 'sim:%'");
    await c.query("DELETE FROM wallets WHERE address LIKE 'sim:%' AND address NOT IN ('sim:creator','sim:holder-a','sim:holder-b')");
    await c.query("INSERT INTO wallets(address,label,balance) VALUES('sim:creator','Demo creator',$1),('sim:holder-a','Holder A',$1),('sim:holder-b','Holder B',$1) ON CONFLICT(address) DO UPDATE SET label=EXCLUDED.label,balance=EXCLUDED.balance", [TEST_BALANCE.toString()]);
    await c.query('DELETE FROM worker_health WHERE id=1');
  });
  return { reset: true };
}

async function scenario(mode: 'creator' | 'holders' | 'king_of_hill' | 'underwater' | 'share' | 'cto_on_creator_sell', name: string, symbol: string, key: string, recipients: unknown[] = []) {
  return createProject(CREATOR, `demo-${key}-launch-v1`, { name, symbol, description: `Demo scenario: ${name}.`, mode, recipients });
}

async function seedUnderwater() {
  const { project } = await scenario('underwater', 'Underwater Entry', 'DIVE', 'underwater');
  await idempotent(CREATOR, 'demo-underwater-state-v1', 'demo-underwater-state', {}, async (c) => {
    const amount = 100_000_000_000n;
    const spent = 1_000_000_000n;
    const fee = 5_000_000n;
    const creatorFee = 3_000_000n;
    await c.query('UPDATE wallets SET balance=balance-$2 WHERE address=$1', [HOLDER_A, spent.toString()]);
    await c.query('INSERT INTO holdings(project_id,wallet,amount) VALUES($1,$2,$3) ON CONFLICT(project_id,wallet) DO UPDATE SET amount=EXCLUDED.amount', [project.id, HOLDER_A, amount.toString()]);
    await c.query('UPDATE projects SET reserve=0,volume=$2,creator_fees=$3,undistributed=$3,custody=$3 WHERE id=$1', [project.id, spent.toString(), creatorFee.toString()]);
    await c.query('INSERT INTO trade_lots(project_id,wallet,side,token_amount,sol_amount) VALUES($1,$2,$3,$4,$5)', [project.id, HOLDER_A, 'buy', amount.toString(), spent.toString()]);
    await c.query('INSERT INTO receipts(id,project_id,source,amount) VALUES($1,$2,$3,$4)', ['demo-underwater-fee-v1', project.id, 'demo-underwater', creatorFee.toString()]);
    await postJournal(c, 'demo-underwater-fee-v1', project.id, [
      { account: 'fee:traders', amount: -fee },
      { account: 'fee:protocol', amount: 1_000_000n },
      { account: 'fee:platform', amount: 1_000_000n },
      { account: 'reward:undistributed', amount: creatorFee },
    ]);
    await recordActivity(c, project.id, HOLDER_A, 'buy', spent, 'sim-demo-underwater-buy');
    return { seeded: true };
  });
  await distribute(HOLDER_A, 'demo-underwater-epoch-v1', project.id);
  return project;
}

export async function loadDemoScenarios() {
  assertSimulator();
  await resetSimulator();

  const creator = await scenario('creator', 'Creator Fees', 'CREATOR', 'creator');
  await trade(HOLDER_A, 'demo-creator-buy-a-v1', creator.project.id, { side: 'buy', amount: '0.25' });
  await distribute(CREATOR, 'demo-creator-epoch-v1', creator.project.id);

  const holders = await scenario('holders', 'Holder Rewards', 'HOLDER', 'holders');
  await trade(HOLDER_A, 'demo-holders-buy-a-v1', holders.project.id, { side: 'buy', amount: '0.30' });
  await trade(HOLDER_B, 'demo-holders-buy-b-v1', holders.project.id, { side: 'buy', amount: '0.20' });
  await distribute(CREATOR, 'demo-holders-epoch-v1', holders.project.id);

  const king = await scenario('king_of_hill', 'Crown Circuit', 'CROWN', 'king');
  await trade(HOLDER_A, 'demo-king-buy-a-v1', king.project.id, { side: 'buy', amount: '0.45' });
  await trade(HOLDER_B, 'demo-king-buy-b-v1', king.project.id, { side: 'buy', amount: '0.22' });
  await distribute(CREATOR, 'demo-king-epoch-v1', king.project.id);

  const share = await scenario('share', 'Open Commons', 'COMMON', 'share', [
    { id: '11111111-1111-4111-8111-111111111111', label: 'Holder A', kind: 'wallet', wallet: HOLDER_A, shareBps: 5000 },
    { id: '22222222-2222-4222-8222-222222222222', label: 'Open Source Collective', kind: 'charity', wallet: 'simulator:open-source-collective', shareBps: 5000 },
  ]);
  await trade(HOLDER_B, 'demo-share-buy-v1', share.project.id, { side: 'buy', amount: '0.30' });
  await distribute(CREATOR, 'demo-share-epoch-v1', share.project.id);

  const cto = await scenario('cto_on_creator_sell', 'CTO Switch', 'CTO', 'cto');
  await trade(CREATOR, 'demo-cto-creator-buy-v1', cto.project.id, { side: 'buy', amount: '0.40' });
  await trade(HOLDER_A, 'demo-cto-holder-buy-v1', cto.project.id, { side: 'buy', amount: '0.20' });
  await trade(CREATOR, 'demo-cto-creator-sell-v1', cto.project.id, { side: 'sell', amount: '1000' });
  await trade(HOLDER_B, 'demo-cto-post-trigger-buy-v1', cto.project.id, { side: 'buy', amount: '0.10' });
  await distribute(HOLDER_A, 'demo-cto-epoch-v1', cto.project.id);

  const graduated = await scenario('holders', 'Graduated Garden', 'GROW', 'graduated');
  await trade(HOLDER_A, 'demo-graduated-buy-v1', graduated.project.id, { side: 'buy', amount: '1.005025125' });
  await migrateProject(CREATOR, 'demo-graduated-migrate-v1', graduated.project.id);

  const underwater = await seedUnderwater();
  return { projects: [creator.project, holders.project, king.project, underwater, share.project, cto.project, graduated.project] };
}
