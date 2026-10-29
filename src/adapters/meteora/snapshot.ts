import { createHash } from "node:crypto";
import { type Connection, PublicKey } from "@solana/web3.js";
import { ACCOUNT_SIZE, MINT_SIZE, TOKEN_PROGRAM_ID, unpackAccount, unpackMint } from "@solana/spl-token";
import { assertDevnet } from "./guard";

export class SnapshotRetryError extends Error {
  readonly code = "SNAPSHOT_RETRY";
}

export interface HolderSnapshot {
  mint: string;
  commitment: "finalized";
  slot: number;
  supplyBeforeSlot: number;
  supplyAfterSlot: number;
  supply: bigint;
  totalAccountBalance: bigint;
  excludedBalance: bigint;
  eligibleBalance: bigint;
  accountCount: number;
  holders: ReadonlyArray<{ owner: string; amount: bigint }>;
  exclusions: { owners: string[]; accounts: string[] };
  hash: string;
}

export interface SnapshotExclusions {
  originalCreator: PublicKey;
  /** Curve/DAMM vault token account addresses, including inactive vaults. */
  vaultAccounts: readonly PublicKey[];
  platformOwners: readonly PublicKey[];
  burnOwners: readonly PublicKey[];
  additionalAccounts?: readonly PublicKey[];
}

type SnapshotConnection = Pick<Connection, "getGenesisHash" | "getAccountInfoAndContext" | "getProgramAccounts">;

/** One full finalized scan, NOT top holders and NOT an exact historical-slot query.
 * RPC truncation/burn races fail closed. Caller retries whole epoch, never records zero rewards.
 */
export async function takeHolderSnapshot(
  connection: SnapshotConnection,
  mintAddress: PublicKey,
  exclusions: SnapshotExclusions,
): Promise<HolderSnapshot> {
  await assertDevnet(connection);
  if (exclusions.vaultAccounts.length === 0) throw new SnapshotRetryError("Known pool vault exclusions required");
  const before = await connection.getAccountInfoAndContext(mintAddress, { commitment: "finalized" });
  if (!before.value || before.value.data.length !== MINT_SIZE) throw new SnapshotRetryError("Classic SPL mint unavailable");
  const mint = unpackMint(mintAddress, before.value, TOKEN_PROGRAM_ID);
  if (!mint.isInitialized || mint.mintAuthority !== null) throw new SnapshotRetryError("Snapshot requires initialized fixed-supply SPL mint");
  const scan = await connection.getProgramAccounts(TOKEN_PROGRAM_ID, {
    commitment: "finalized", withContext: true, minContextSlot: before.context.slot,
    filters: [{ dataSize: ACCOUNT_SIZE }, { memcmp: { offset: 0, bytes: mintAddress.toBase58() } }],
  });
  const after = await connection.getAccountInfoAndContext(mintAddress, {
    commitment: "finalized", minContextSlot: scan.context.slot,
  });
  if (!after.value || after.value.data.length !== MINT_SIZE) throw new SnapshotRetryError("Mint missing after scan");
  const afterMint = unpackMint(mintAddress, after.value, TOKEN_PROGRAM_ID);
  if (before.context.slot > scan.context.slot || scan.context.slot > after.context.slot ||
      mint.supply !== afterMint.supply || mint.decimals !== afterMint.decimals ||
      afterMint.mintAuthority !== null || !afterMint.isInitialized) {
    throw new SnapshotRetryError("Supply or context changed during snapshot; retry");
  }
  const ownersExcluded = new Set([
    exclusions.originalCreator, ...exclusions.platformOwners, ...exclusions.burnOwners,
  ].map((key) => key.toBase58()));
  const accountsExcluded = new Set([
    ...exclusions.vaultAccounts, ...(exclusions.additionalAccounts ?? []),
  ].map((key) => key.toBase58()));
  const owners = new Map<string, bigint>();
  const seen = new Set<string>();
  let total = 0n;
  let excluded = 0n;
  for (const row of scan.value) {
    const address = row.pubkey.toBase58();
    if (seen.has(address)) throw new SnapshotRetryError("Duplicate token account in snapshot");
    seen.add(address);
    if (row.account.data.length !== ACCOUNT_SIZE) throw new SnapshotRetryError("Unexpected token account size");
    const account = unpackAccount(row.pubkey, row.account, TOKEN_PROGRAM_ID);
    if (!account.isInitialized || !account.mint.equals(mintAddress) || account.isNative) {
      throw new SnapshotRetryError("Unexpected token account in mint scan");
    }
    total += account.amount;
    const owner = account.owner.toBase58();
    if (ownersExcluded.has(owner) || accountsExcluded.has(address)) excluded += account.amount;
    else if (account.amount > 0n) owners.set(owner, (owners.get(owner) ?? 0n) + account.amount);
  }
  if (total !== mint.supply) throw new SnapshotRetryError("Full account sum does not equal mint supply; incomplete or racing RPC snapshot");
  const holders = [...owners.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([owner, amount]) => ({ owner, amount }));
  const exclusionList = { owners: [...ownersExcluded].sort(), accounts: [...accountsExcluded].sort() };
  const hash = createHash("sha256").update(JSON.stringify({
    mint: mintAddress.toBase58(), slot: scan.context.slot, supply: mint.supply.toString(),
    exclusions: exclusionList, holders: holders.map((h) => ({ owner: h.owner, amount: h.amount.toString() })),
  })).digest("hex");
  return {
    mint: mintAddress.toBase58(), commitment: "finalized", slot: scan.context.slot,
    supplyBeforeSlot: before.context.slot, supplyAfterSlot: after.context.slot,
    supply: mint.supply, totalAccountBalance: total, excludedBalance: excluded,
    eligibleBalance: total - excluded, accountCount: seen.size, holders, exclusions: exclusionList, hash,
  };
}
