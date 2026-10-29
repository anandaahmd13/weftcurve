import { describe, it, expect, vi } from "vitest";
import { Keypair, PublicKey, SystemInstruction, Transaction } from "@solana/web3.js";
import { DEVNET_GENESIS_HASH } from "../../src/adapters/meteora/guard";
import { DevnetPayoutSigner, assertPayoutBinding, type AuthorizedPayoutJob, type SignedPayoutAttempt, type PayoutJobStore } from "../../src/server/signing/payout";

// Public RFC 8032 test vectors, NOT generated or operational secrets. Offline tests only.
const reserve = Keypair.fromSecretKey(Buffer.from("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a", "hex"));
const feePayer = Keypair.fromSecretKey(Buffer.from("4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c", "hex"));
const destination = new PublicKey(Buffer.from("fc51cd8e6218a1a38da47ed00230f0580816ed13ba3303ac5deb911548908025", "hex"));
const blockhash = new PublicKey(new Uint8Array(32).fill(30)).toBase58();
function fixture(overrides: Partial<AuthorizedPayoutJob> = {}) {
  const job: AuthorizedPayoutJob = { id: "job-1", projectId: "project-1", reservationId: "reservation-1", network: "devnet", asset: "SOL",
    claimant: destination.toBase58(), destination: destination.toBase58(), amountLamports: "1234567", reserveAddress: reserve.publicKey.toBase58(),
    feePayerAddress: feePayer.publicKey.toBase58(), status: "reserved", ...overrides };
  let persisted: SignedPayoutAttempt | null = null;
  const store: PayoutJobStore = {
    loadAuthorizedJob: vi.fn(async () => job),
    getSignedAttempt: vi.fn(async () => persisted),
    saveSignedAttemptIfAbsent: vi.fn(async (attempt) => persisted ??= { ...attempt }),
  };
  const rpc = {
    getGenesisHash: vi.fn().mockResolvedValue(DEVNET_GENESIS_HASH),
    getLatestBlockhash: vi.fn().mockResolvedValue({ blockhash, lastValidBlockHeight: 200 }),
    getBalance: vi.fn().mockResolvedValue(100_000_000),
    getFeeForMessage: vi.fn().mockResolvedValue({ context: { slot: 10 }, value: 10_000 }),
    getBlockHeight: vi.fn().mockResolvedValue(100),
    getSignatureStatuses: vi.fn().mockResolvedValue({ context: { slot: 10 }, value: [null] }),
    sendRawTransaction: vi.fn(async (_raw: Uint8Array) => { void _raw; return persisted!.signature; }),
  };
  const signer = new DevnetPayoutSigner(rpc, store, { enabled: true, reserve, feePayer, maxPayoutLamports: 100_000_000n });
  return { signer, rpc, job, store, get persisted() { return persisted; } };
}

describe("structured devnet payout signer", () => {
  it("durably saves exact signed destination and amount before any broadcast", async () => {
    const f = fixture();
    const attempt = await f.signer.prepare(f.job.id);
    expect(f.store.saveSignedAttemptIfAbsent).toHaveBeenCalledOnce();
    expect(f.rpc.sendRawTransaction).not.toHaveBeenCalled();
    expect(f.persisted).toEqual(attempt);
    expect(attempt).toMatchObject({ blockhash, lastValidBlockHeight: 200, genesisHash: DEVNET_GENESIS_HASH });
    const tx = Transaction.from(assertPayoutBinding(f.job, attempt));
    expect(tx.feePayer?.equals(feePayer.publicKey)).toBe(true);
    const transfer = SystemInstruction.decodeTransfer(tx.instructions[0]);
    expect(transfer.lamports).toBe(1_234_567n);
    expect(transfer.fromPubkey.equals(reserve.publicKey)).toBe(true);
    expect(transfer.toPubkey.equals(destination)).toBe(true);
    expect(tx.verifySignatures()).toBe(true);
  });
  it("rejects destination or amount changes to authorized binding", async () => {
    const f = fixture();
    const attempt = await f.signer.prepare(f.job.id);
    expect(() => assertPayoutBinding({ ...f.job, amountLamports: "1234568" }, attempt)).toThrow("differs");
    expect(() => assertPayoutBinding({ ...f.job, destination: feePayer.publicKey.toBase58() }, attempt)).toThrow();
    expect(() => assertPayoutBinding(f.job, { ...attempt, transactionBase64: attempt.transactionBase64.slice(0, -4) + "AAAA" })).toThrow("bytes were changed");
    expect(() => assertPayoutBinding(f.job, { ...attempt, blockhash: destination.toBase58() })).toThrow("envelope");
  });
  it("rejects client-controlled destination, subminimum, noninteger and excessive amounts", async () => {
    for (const amount of ["999999", "100000001", "1.2", "01", "-1"]) {
      const f = fixture({ amountLamports: amount });
      await expect(f.signer.prepare(f.job.id)).rejects.toThrow();
      expect(f.rpc.sendRawTransaction).not.toHaveBeenCalled();
    }
    const f = fixture({ claimant: reserve.publicKey.toBase58() });
    await expect(f.signer.prepare(f.job.id)).rejects.toThrow("authenticated claimant");
  });
  it("rejects wrong genesis and missing authorization", async () => {
    const f = fixture();
    f.rpc.getGenesisHash.mockResolvedValue("mainnet");
    await expect(f.signer.prepare(f.job.id)).rejects.toThrow("not Solana devnet");
    expect(f.store.loadAuthorizedJob).not.toHaveBeenCalled();
    const g = fixture();
    vi.mocked(g.store.loadAuthorizedJob).mockResolvedValue(null);
    await expect(g.signer.prepare(g.job.id)).rejects.toThrow("unavailable");
  });
  it("halts on reserve or fee payer shortage without reducing payout", async () => {
    const f = fixture();
    f.rpc.getBalance.mockResolvedValueOnce(1).mockResolvedValueOnce(100_000_000);
    await expect(f.signer.prepare(f.job.id)).rejects.toThrow("Insufficient payout reserve");
    expect(f.store.saveSignedAttemptIfAbsent).not.toHaveBeenCalled();
    const g = fixture();
    g.rpc.getBalance.mockResolvedValueOnce(100_000_000).mockResolvedValueOnce(1);
    await expect(g.signer.prepare(g.job.id)).rejects.toThrow("operational fee payer");
  });
  it("rebroadcasts identical persisted bytes and never builds replacement", async () => {
    const f = fixture();
    const attempt = await f.signer.prepare(f.job.id);
    await f.signer.broadcast(f.job.id);
    f.job.status = "submitted";
    expect(await f.signer.prepare(f.job.id)).toEqual(attempt);
    await f.signer.broadcast(f.job.id);
    expect(f.rpc.getLatestBlockhash).toHaveBeenCalledOnce();
    expect(f.rpc.sendRawTransaction).toHaveBeenCalledTimes(2);
    for (const call of f.rpc.sendRawTransaction.mock.calls) expect(call[0]).toEqual(Buffer.from(attempt.transactionBase64, "base64"));
  });
  it("holds unknown and expired attempts; no refund or rebuild inferred from absence", async () => {
    const f = fixture();
    const attempt = await f.signer.prepare(f.job.id);
    f.rpc.getBlockHeight.mockResolvedValue(201);
    expect(await f.signer.reconcile(f.job.id)).toMatchObject({ state: "unknown", expired: true });
    expect(await f.signer.broadcast(f.job.id)).toMatchObject({ state: "unknown", expired: true });
    expect(f.rpc.sendRawTransaction).not.toHaveBeenCalled();
    f.job.status = "review";
    expect(await f.signer.prepare(f.job.id)).toEqual(attempt);
    const g = fixture({ status: "submitted" });
    await expect(g.signer.prepare(g.job.id)).rejects.toThrow("may never be rebuilt");
  });
  it("treats send timeout and RPC history failure as unknown", async () => {
    const f = fixture();
    await f.signer.prepare(f.job.id);
    f.rpc.sendRawTransaction.mockRejectedValue(new Error("timeout"));
    expect(await f.signer.broadcast(f.job.id)).toMatchObject({ state: "unknown" });
    f.rpc.getSignatureStatuses.mockRejectedValue(new Error("history unavailable"));
    expect(await f.signer.reconcile(f.job.id)).toMatchObject({ state: "unknown", expired: null });
  });
  it("finalizes only rooted status; confirmed failures stay unknown", async () => {
    const f = fixture();
    await f.signer.prepare(f.job.id);
    f.rpc.getSignatureStatuses.mockResolvedValue({ value: [{ slot: 123, confirmationStatus: "confirmed", err: { InstructionError: [0, "error"] } }] });
    expect(await f.signer.reconcile(f.job.id)).toMatchObject({ state: "unknown" });
    f.rpc.getSignatureStatuses.mockResolvedValue({ value: [{ slot: 123, confirmationStatus: "finalized", err: null }] });
    expect(await f.signer.reconcile(f.job.id)).toMatchObject({ state: "finalized", slot: 123 });
    expect(await f.signer.broadcast(f.job.id)).toMatchObject({ state: "finalized" });
    expect(f.rpc.sendRawTransaction).not.toHaveBeenCalled();
    f.rpc.getSignatureStatuses.mockResolvedValue({ value: [{ slot: 123, confirmationStatus: "finalized", err: { InstructionError: [0, "error"] } }] });
    expect(await f.signer.reconcile(f.job.id)).toMatchObject({ state: "failed", slot: 123 });
  });
  it("requires separate reserve and fee payer", () => {
    const f = fixture();
    expect(() => new DevnetPayoutSigner(f.rpc, f.store, { enabled: true, reserve, feePayer: reserve, maxPayoutLamports: 10_000_000n })).toThrow("Separate reserve");
  });
});
