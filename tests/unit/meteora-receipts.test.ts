import { describe, expect, it, vi } from "vitest";
import bs58 from "bs58";
import { Keypair, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { NATIVE_MINT, TOKEN_PROGRAM_ID, createCloseAccountInstruction, createTransferCheckedInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { DYNAMIC_BONDING_CURVE_PROGRAM_ID, DAMM_V2_PROGRAM_ID, deriveDbcPoolAuthority } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { derivePoolAuthority } from "@meteora-ag/cp-amm-sdk";
import { DEVNET_GENESIS_HASH } from "../../src/adapters/meteora/guard";
import { verifyCollectedFee, type CollectOperation } from "../../src/adapters/meteora/receipts";

// Published RFC 8032 fixtures only. No generated or operational secrets.
const collector = Keypair.fromSecretKey(Buffer.from("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a", "hex"));
const payer = Keypair.fromSecretKey(Buffer.from("4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c", "hex"));
const pk = (n: number) => new PublicKey(new Uint8Array(32).fill(n));
function fixture(damm = false, wrongClose = false) {
  const program = damm ? DAMM_V2_PROGRAM_ID : DYNAMIC_BONDING_CURVE_PROGRAM_ID;
  const authority = damm ? derivePoolAuthority() : deriveDbcPoolAuthority();
  const eventAuthority = PublicKey.findProgramAddressSync([Buffer.from("__event_authority")], program)[0];
  const pool = pk(10), baseMint = pk(11), baseVault = pk(12), quoteVault = pk(13), receiver = pk(14), position = pk(15), nft = pk(16);
  const baseAta = getAssociatedTokenAddressSync(baseMint, receiver, true), quoteAta = getAssociatedTokenAddressSync(NATIVE_MINT, collector.publicKey, true);
  const accounts = damm
    ? [authority, pool, position, baseAta, quoteAta, baseVault, quoteVault, baseMint, NATIVE_MINT, nft, collector.publicKey, TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, eventAuthority, program]
    : [authority, pool, baseAta, quoteAta, baseVault, quoteVault, baseMint, NATIVE_MINT, collector.publicKey, TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, eventAuthority, program];
  const claimData = Buffer.alloc(damm ? 8 : 24);
  Buffer.from(damm ? [180, 38, 154, 17, 133, 33, 162, 211] : [82, 220, 250, 189, 3, 85, 107, 45]).copy(claimData);
  if (!damm) claimData.writeBigUInt64LE(100_000_000n, 16);
  const tx = new Transaction({ feePayer: payer.publicKey, blockhash: pk(19).toBase58(), lastValidBlockHeight: 200 });
  tx.add(new TransactionInstruction({ programId: program, data: claimData, keys: accounts.map((pubkey) => ({ pubkey, isSigner: pubkey.equals(collector.publicKey), isWritable: !pubkey.equals(program) && !pubkey.equals(TOKEN_PROGRAM_ID) })) }));
  tx.add(createCloseAccountInstruction(quoteAta, wrongClose ? pk(17) : receiver, collector.publicKey));
  tx.sign(payer, collector);
  const message = tx.compileMessage();
  const index = (p: PublicKey) => message.accountKeys.findIndex((k) => k.equals(p));
  const event = Buffer.alloc(damm ? 128 : 64);
  Buffer.from("e445a52e51cb9a1d", "hex").copy(event);
  Buffer.from(damm ? [198, 182, 183, 52, 97, 12, 49, 56] : [154, 228, 215, 202, 133, 155, 214, 138]).copy(event, 8);
  pool.toBuffer().copy(event, 16);
  if (damm) { position.toBuffer().copy(event, 48); collector.publicKey.toBuffer().copy(event, 80); }
  event.writeBigUInt64LE(3_000_000n, damm ? 120 : 56);
  const transfer = createTransferCheckedInstruction(quoteVault, NATIVE_MINT, quoteAta, authority, 3_000_000n, 9);
  const inner = [
    { programIdIndex: index(TOKEN_PROGRAM_ID), accounts: transfer.keys.map((k) => index(k.pubkey)), data: bs58.encode(transfer.data) },
    { programIdIndex: index(program), accounts: [index(eventAuthority)], data: bs58.encode(event) },
  ];
  const signature = bs58.encode(tx.signature!);
  const op: CollectOperation = { id: "collect-1", projectId: "project-1", network: "devnet", kind: damm ? "damm-position" : "dbc-creator",
    signature, transactionBase64: tx.serialize().toString("base64"), pool: pool.toBase58(), baseMint: baseMint.toBase58(), baseVault: baseVault.toBase58(), quoteVault: quoteVault.toBase58(),
    collector: collector.publicKey.toBase58(), receiver: receiver.toBase58(), feePayer: payer.publicKey.toBase58(), ...(damm ? { position: position.toBase58(), positionNftAccount: nft.toBase58() } : {}) };
  const result = { slot: 123, transaction: { message, signatures: tx.signatures.map((s) => bs58.encode(s.signature!)) },
    meta: { err: null, fee: 10_000, preBalances: [100_000_000], postBalances: [9_999_999_999], innerInstructions: [{ index: 0, instructions: inner }] } };
  const rpc = {
    getGenesisHash: vi.fn().mockResolvedValue(DEVNET_GENESIS_HASH),
    getMultipleAccountsInfo: vi.fn().mockResolvedValue([{ executable: true }, { executable: true }]),
    getTransaction: vi.fn().mockResolvedValue(result),
  };
  const store = { loadCollectOperation: vi.fn().mockResolvedValue(op) };
  return { rpc, store, result, inner, event, op, index, program, eventAuthority };
}

describe("finalized trusted fee receipts", () => {
  it.each([false, true])("credits exact fee event and vault transfer, never SOL delta (DAMM=%s)", async (damm) => {
    const f = fixture(damm);
    expect(await verifyCollectedFee(f.rpc, f.store, f.op.id)).toMatchObject({ amountLamports: "3000000", instructionIndex: 0, slot: 123, source: damm ? "damm-position" : "dbc-creator" });
    expect(f.rpc.getTransaction).toHaveBeenCalledWith(f.op.signature, { commitment: "finalized", maxSupportedTransactionVersion: 0 });
  });
  it("rejects untrusted operation IDs and wrong network", async () => {
    const f = fixture();
    f.store.loadCollectOperation.mockResolvedValue(null);
    await expect(verifyCollectedFee(f.rpc, f.store, f.op.id)).rejects.toThrow("trusted collection");
    const g = fixture();
    g.rpc.getGenesisHash.mockResolvedValue("mainnet");
    await expect(verifyCollectedFee(g.rpc, g.store, g.op.id)).rejects.toThrow("not Solana devnet");
  });
  it("rejects wrong unwrap receiver even in signed transaction", async () => {
    const f = fixture(false, true);
    await expect(verifyCollectedFee(f.rpc, f.store, f.op.id)).rejects.toThrow("unwrap receiver mismatch");
  });
  it("rejects event from wrong program or authority", async () => {
    const f = fixture();
    f.inner[1].programIdIndex = f.index(TOKEN_PROGRAM_ID);
    await expect(verifyCollectedFee(f.rpc, f.store, f.op.id)).rejects.toThrow("unexpected token CPI");
    const g = fixture();
    g.inner[1].accounts = [g.index(g.program)];
    await expect(verifyCollectedFee(g.rpc, g.store, g.op.id)).rejects.toThrow("provenance mismatch");
  });
  it("rejects duplicated event provenance and detached inner group", async () => {
    const f = fixture();
    f.inner.push({ ...f.inner[1] });
    await expect(verifyCollectedFee(f.rpc, f.store, f.op.id)).rejects.toThrow("duplicate or unexpected");
    const g = fixture();
    g.result.meta.innerInstructions[0].index = 1;
    await expect(verifyCollectedFee(g.rpc, g.store, g.op.id)).rejects.toThrow("trace missing");
  });
  it("rejects rent-contaminated or invented event amount", async () => {
    const f = fixture();
    f.event.writeBigUInt64LE(5_039_280n, 56);
    f.inner[1].data = bs58.encode(f.event);
    await expect(verifyCollectedFee(f.rpc, f.store, f.op.id)).rejects.toThrow("does not match actual quote transfer");
  });
  it("rejects wrong vault destination and wrong event pool", async () => {
    const f = fixture();
    f.inner[0].accounts[2] = f.index(new PublicKey(f.op.baseVault));
    await expect(verifyCollectedFee(f.rpc, f.store, f.op.id)).rejects.toThrow("source or destination");
    const g = fixture();
    pk(31).toBuffer().copy(g.event, 16);
    g.inner[1].data = bs58.encode(g.event);
    await expect(verifyCollectedFee(g.rpc, g.store, g.op.id)).rejects.toThrow("event pool mismatch");
  });
  it("rejects missing transaction or changed finalized message", async () => {
    const f = fixture();
    f.rpc.getTransaction.mockResolvedValue(null);
    await expect(verifyCollectedFee(f.rpc, f.store, f.op.id)).rejects.toThrow("missing");
    const g = fixture();
    g.result.transaction.message.recentBlockhash = pk(32).toBase58();
    await expect(verifyCollectedFee(g.rpc, g.store, g.op.id)).rejects.toThrow("message differs");
  });
});
