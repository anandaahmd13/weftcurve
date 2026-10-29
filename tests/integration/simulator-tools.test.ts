import { beforeAll,afterAll,describe,it,expect } from 'vitest';
import { db } from '../../src/server/db/client';
import { migrate } from '../../src/server/db/migrate';
import { loadDemoScenarios, resetSimulator } from '../../src/server/simulator-tools';

describe('local simulator tools', () => {
  beforeAll(async () => { await migrate(); await resetSimulator(); });
  afterAll(() => db.end());

  it('loads deterministic scenarios spanning all destinations and an active graduated pool', async () => {
    const result = await loadDemoScenarios();
    expect(result.projects).toHaveLength(7);
    const rows = (await db.query("SELECT name,mode,status,cto_active FROM projects WHERE network='simulator' ORDER BY name")).rows;
    expect(rows.map((row) => row.mode).sort()).toEqual(['creator','cto_on_creator_sell','holders','holders','king_of_hill','share','underwater'].sort());
    expect(rows.find((row) => row.name === 'Graduated Garden')).toMatchObject({ status: 'graduated' });
    expect(rows.find((row) => row.name === 'CTO Switch')).toMatchObject({ cto_active: true });
    expect((await db.query("SELECT count(*) FROM activity WHERE type='cto_trigger'")).rows[0].count).toBe('1');
  });

  it('resets only local simulator data and leaves demo identities ready to use', async () => {
    await resetSimulator();
    expect((await db.query("SELECT count(*) FROM projects WHERE network='simulator'")).rows[0].count).toBe('0');
    expect((await db.query("SELECT count(*) FROM wallets WHERE address IN ('sim:creator','sim:holder-a','sim:holder-b')")).rows[0].count).toBe('3');
    expect((await db.query("SELECT count(*) FROM journal")).rows[0].count).toBe('0');
  });
});
