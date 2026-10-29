import { describe, it, expect, vi } from "vitest";
import { Connection, PublicKey, type AccountInfo } from "@solana/web3.js";
import { AccountLayout, MintLayout, TOKEN_PROGRAM_ID, AccountState } from "@solana/spl-token";
import { CollectFeeMode, MigratedCollectFeeMode, MigrationFeeOption, TokenType } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { CollectFeeMode as DammCollectFeeMode } from "@meteora-ag/cp-amm-sdk";
import { DEVNET_GENESIS_HASH, assertDevnet, assertExecutablePrograms, inspectMeteoraCapability } from "../../src/adapters/meteora/guard";
import { buildLaunchTemplate, launchTemplateParameters, TOKEN_SUPPLY_RAW, launchFeeDisclosure, EXPECTED_DAMM_COLLECT_FEE_MODE } from "../../src/adapters/meteora/template";
import { takeHolderSnapshot } from "../../src/adapters/meteora/snapshot";
import { validateLaunchIntent, type LaunchIntent, MeteoraDevnetAdapter } from "../../src/adapters/meteora/client";

const pk = (n: number) => new PublicKey(new Uint8Array(32).fill(n));
const mint = pk(1), creator = pk(2), owner = pk(3), vault = pk(4), platform = pk(5), burn = pk(6);
const info = (data: Buffer): AccountInfo<Buffer> => ({ data, owner: TOKEN_PROGRAM_ID, lamports: 1, executable: false, rentEpoch: 0 });
function mintInfo(supply: bigint) {
  const data = Buffer.alloc(MintLayout.span);
  MintLayout.encode({ mintAuthorityOption: 0, mintAuthority: PublicKey.default, supply, decimals: 6,
    isInitialized: true, freezeAuthorityOption: 0, freezeAuthority: PublicKey.default }, data);
  return info(data);
}
function token(address: PublicKey, tokenOwner: PublicKey, amount: bigint) {
  const data = Buffer.alloc(AccountLayout.span);
  AccountLayout.encode({ mint, owner: tokenOwner, amount, delegateOption: 0, delegate: PublicKey.default,
    state: AccountState.Initialized, isNativeOption: 0, isNative: 0n, delegatedAmount: 0n,
    closeAuthorityOption: 0, closeAuthority: PublicKey.default }, data);
  return { pubkey: address, account: info(data) };
}
const exclusions = { originalCreator: creator, vaultAccounts: [vault], platformOwners: [platform], burnOwners: [burn] };
function snapshotRpc(rows: ReturnType<typeof token>[], supply: bigint, afterSupply = supply) {
  return {
    getGenesisHash: vi.fn().mockResolvedValue(DEVNET_GENESIS_HASH),
    getAccountInfoAndContext: vi.fn().mockResolvedValueOnce({ context: { slot: 100 }, value: mintInfo(supply) })
      .mockResolvedValueOnce({ context: { slot: 102 }, value: mintInfo(afterSupply) }),
    getProgramAccounts: vi.fn().mockResolvedValue({ context: { slot: 101 }, value: rows }),
  };
}

describe("devnet capability guard", () => {
  it("uses verified devnet genesis, rejecting mainnet and testnet", async () => {
    expect(DEVNET_GENESIS_HASH).toBe("EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG");
    for (const hash of ["5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY", "local"]) {
      await expect(assertDevnet({ getGenesisHash: async () => hash })).rejects.toThrow("not Solana devnet");
    }
    await expect(assertDevnet({ getGenesisHash: async () => DEVNET_GENESIS_HASH })).resolves.toBeUndefined();
  });
  it("fails closed before configuration and requires executable programs", async () => {
    expect((await inspectMeteoraCapability(null)).enabled).toBe(false);
    await expect(assertExecutablePrograms({ getMultipleAccountsInfo: vi.fn().mockResolvedValue([info(Buffer.alloc(0))]) }, [pk(1)])).rejects.toThrow("program unavailable");
    const connection = { getGenesisHash: async () => DEVNET_GENESIS_HASH, getMultipleAccountsInfo: vi.fn().mockResolvedValue([{ ...info(Buffer.alloc(0)), executable: true }]) };
    await expect(assertExecutablePrograms(connection, [pk(1)])).resolves.toBeUndefined();
    expect((await inspectMeteoraCapability(connection, false)).enabled).toBe(false);
  });
  it("adapter requires finalized connection and explicit enablement", async () => {
    expect(() => new MeteoraDevnetAdapter(new Connection("https://unused.invalid", "confirmed"))).toThrow("finalized");
    const adapter = new MeteoraDevnetAdapter(new Connection("https://unused.invalid", "finalized"));
    expect((await adapter.capability()).enabled).toBe(false);
    await expect(adapter.readCurve(pk(7))).rejects.toThrow("not explicitly enabled");
  });
});

describe("SDK launch template", () => {
  it("validates 1B SPL, 1 SOL threshold, constant fees, no hooks and permanent locks", () => {
    const template = buildLaunchTemplate(pk(20));
    expect(template.tokenType).toBe(TokenType.SPLToken);
    expect(template.tokenDecimal).toBe(6);
    expect(template.tokenSupply?.preMigrationTokenSupply.toString()).toBe(TOKEN_SUPPLY_RAW.toString());
    expect(template.tokenSupply?.postMigrationTokenSupply.toString()).toBe(TOKEN_SUPPLY_RAW.toString());
    expect(template.migrationQuoteThreshold.toString()).toBe("1000000000");
    expect(template.collectFeeMode).toBe(CollectFeeMode.QuoteToken);
    expect(template.creatorTradingFeePercentage).toBe(75);
    expect(template.poolFees.baseFee.cliffFeeNumerator.toString()).toBe("5000000");
    expect(template.poolFees.dynamicFee).toBeNull();
    expect(template.poolCreationFee.isZero()).toBe(true);
    expect(template.migrationFeeOption).toBe(MigrationFeeOption.Customizable);
    expect(template.migratedPoolFee.poolFeeBps).toBe(50);
    expect(template.migratedPoolFee.collectFeeMode).toBe(MigratedCollectFeeMode.QuoteToken);
    expect(template.partnerPermanentLockedLiquidityPercentage).toBe(50);
    expect(template.creatorPermanentLockedLiquidityPercentage).toBe(50);
    expect(template.partnerLiquidityPercentage + template.creatorLiquidityPercentage).toBe(0);
    expect(launchTemplateParameters().percentageSupplyOnMigration).toBe(25);
    expect(EXPECTED_DAMM_COLLECT_FEE_MODE).toBe(DammCollectFeeMode.OnlyB);
    expect(Number(MigratedCollectFeeMode.QuoteToken)).not.toBe(Number(DammCollectFeeMode.OnlyB));
    expect(launchFeeDisclosure()).toMatchObject({ protocolBps: 10, creatorSideBps: 30, partnerSideBps: 10 });
  });
  it("binds pool authority to immutable reward mode", () => {
    const intent: LaunchIntent = { id: "intent", network: "devnet", status: "authorized", mode: "creator", holderShareBps: 0, recipients: [],
      originalCreator: creator.toBase58(), payer: creator.toBase58(), poolCreator: creator.toBase58(),
      partnerFeeClaimer: platform.toBase58(), leftoverReceiver: burn.toBase58(), mint: mint.toBase58(), config: pk(8).toBase58(), name: "Test", symbol: "TEST", uri: "http://localhost:3000/metadata/test.json" };
    expect(() => validateLaunchIntent(intent)).not.toThrow();
    expect(() => validateLaunchIntent({ ...intent, mode: "holders", holderShareBps: 0, poolCreator: owner.toBase58() })).not.toThrow();
    expect(() => validateLaunchIntent({ ...intent, mode: "share", poolCreator: owner.toBase58(), recipients: [{ id: "one", label: "Wallet", kind: "wallet", wallet: owner.toBase58(), shareBps: 10_000 }] })).not.toThrow();
    expect(() => validateLaunchIntent({ ...intent, holderShareBps: 5_000 })).toThrow("synthetic holder split");
  });
});

describe("full finalized holder snapshot", () => {
  it("aggregates all owner accounts with bigint and excludes creator, vaults, burn and platform", async () => {
    const big = 9_007_199_254_740_993n;
    const rows = [token(pk(10), owner, big), token(pk(11), owner, 7n), token(pk(12), creator, 10n), token(vault, pk(21), 20n), token(pk(13), platform, 30n), token(pk(14), burn, 40n)];
    const rpc = snapshotRpc(rows, big + 107n);
    const snapshot = await takeHolderSnapshot(rpc, mint, exclusions);
    expect(snapshot.holders).toEqual([{ owner: owner.toBase58(), amount: big + 7n }]);
    expect(snapshot.excludedBalance).toBe(100n);
    expect(snapshot.totalAccountBalance).toBe(snapshot.supply);
    expect(snapshot.eligibleBalance + snapshot.excludedBalance).toBe(snapshot.supply);
    expect(snapshot.slot).toBe(101);
    expect(rpc.getProgramAccounts).toHaveBeenCalledWith(TOKEN_PROGRAM_ID, expect.objectContaining({ commitment: "finalized", withContext: true, minContextSlot: 100 }));
    expect(rpc.getAccountInfoAndContext).toHaveBeenLastCalledWith(mint, { commitment: "finalized", minContextSlot: 101 });
  });
  it("rejects truncation instead of inventing zero rewards", async () => {
    await expect(takeHolderSnapshot(snapshotRpc([token(pk(10), owner, 5n)], 10n), mint, exclusions)).rejects.toThrow("Full account sum");
  });
  it("retries supply changes from burns", async () => {
    await expect(takeHolderSnapshot(snapshotRpc([token(pk(10), owner, 10n)], 10n, 9n), mint, exclusions)).rejects.toThrow("Supply or context changed");
  });
  it("rejects duplicate accounts and context reversal", async () => {
    const row = token(pk(10), owner, 5n);
    await expect(takeHolderSnapshot(snapshotRpc([row, row], 10n), mint, exclusions)).rejects.toThrow("Duplicate");
    const rpc = snapshotRpc([row], 5n);
    rpc.getProgramAccounts.mockResolvedValue({ context: { slot: 99 }, value: [row] });
    await expect(takeHolderSnapshot(rpc, mint, exclusions)).rejects.toThrow("Supply or context changed");
  });
  it("requires explicit vault exclusions", async () => {
    await expect(takeHolderSnapshot(snapshotRpc([], 0n), mint, { ...exclusions, vaultAccounts: [] })).rejects.toThrow("vault exclusions");
  });
});
