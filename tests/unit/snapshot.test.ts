import { describe, expect, it, vi } from 'vitest';
import { Keypair, PublicKey } from '@solana/web3.js';
import { ACCOUNT_SIZE, MINT_SIZE, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { SnapshotRetryError, takeHolderSnapshot } from '../../src/adapters/meteora/snapshot';
import { DEVNET_GENESIS_HASH } from '../../src/adapters/meteora/guard';

const mint = new PublicKey(new Uint8Array(32).fill(1));
const owner = Keypair.fromSeed(new Uint8Array(32).fill(2)).publicKey;
const creator = Keypair.fromSeed(new Uint8Array(32).fill(3)).publicKey;
const vault = new PublicKey(new Uint8Array(32).fill(4));
function mintData(supply: bigint, authority: PublicKey | null = null) {
  const data = Buffer.alloc(MINT_SIZE);
  data.writeUInt32LE(authority ? 1 : 0, 0);
  if (authority) authority.toBuffer().copy(data, 4);
  data.writeBigUInt64LE(supply, 36);
  data[44] = 6;
  data[45] = 1;
  data.writeUInt32LE(0, 46);
  return data;
}
function tokenData(tokenOwner: PublicKey, amount: bigint) {
  const data = Buffer.alloc(ACCOUNT_SIZE);
  mint.toBuffer().copy(data, 0);
  tokenOwner.toBuffer().copy(data, 32);
  data.writeBigUInt64LE(amount, 64);
  data.writeUInt32LE(1, 108);
  data.writeUInt32LE(0, 109);
  data.writeUInt32LE(0, 129);
  return data;
}
function rpc({ supplyAfter = 100n, accountSum = 100n, authority = null as PublicKey | null } = {}) {
  const account = { pubkey: new PublicKey(new Uint8Array(32).fill(5)), account: { data: tokenData(owner, accountSum), executable: false, owner: TOKEN_PROGRAM_ID, lamports: 1, rentEpoch: 0 } };
  return {
    getGenesisHash: vi.fn().mockResolvedValue(DEVNET_GENESIS_HASH),
    getAccountInfoAndContext: vi.fn().mockResolvedValueOnce({ context: { slot: 10 }, value: { data: mintData(100n, authority), executable: false, owner: TOKEN_PROGRAM_ID, lamports: 1, rentEpoch: 0 } }).mockResolvedValueOnce({ context: { slot: 12 }, value: { data: mintData(supplyAfter, authority), executable: false, owner: TOKEN_PROGRAM_ID, lamports: 1, rentEpoch: 0 } }),
    getProgramAccounts: vi.fn().mockResolvedValue({ context: { slot: 11 }, value: [account] }),
  };
}
describe('full holder snapshots', () => {
  const exclusions = { originalCreator: creator, vaultAccounts: [vault], platformOwners: [], burnOwners: [] };
  it('aggregates raw balances and records complete context', async () => {
    const snapshot = await takeHolderSnapshot(rpc(), mint, exclusions);
    expect(snapshot).toMatchObject({ slot: 11, supply: 100n, totalAccountBalance: 100n, eligibleBalance: 100n, accountCount: 1 });
    expect(snapshot.holders).toEqual([{ owner: owner.toBase58(), amount: 100n }]);
  });
  it.each([
    ['supply changed', rpc({ supplyAfter: 99n })],
    ['incomplete account sum', rpc({ accountSum: 99n })],
    ['mint authority still enabled', rpc({ authority: creator })],
  ])('fails closed when %s', async (_, connection) => {
    await expect(takeHolderSnapshot(connection, mint, exclusions)).rejects.toBeInstanceOf(SnapshotRetryError);
  });
  it('requires known vault exclusions', async () => {
    await expect(takeHolderSnapshot(rpc(), mint, { ...exclusions, vaultAccounts: [] })).rejects.toThrow('Known pool vault');
  });
});
