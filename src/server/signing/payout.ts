import { createHash } from "node:crypto";
import bs58 from "bs58";
import { Keypair, PublicKey, SystemInstruction, SystemProgram, Transaction, type Connection } from "@solana/web3.js";
import { assertDevnet, DEVNET_GENESIS_HASH } from "../../adapters/meteora/guard";
import { assertServerRuntime } from "./runtime";

export const MIN_PAYOUT_LAMPORTS = 1_000_000n;

/** Loaded only from trusted server reservation/outbox, never request JSON. */
export interface AuthorizedPayoutJob {
  id: string;
  projectId: string;
  reservationId: string;
  network: "devnet";
  asset: "SOL";
  claimant: string;
  destination: string;
  amountLamports: string;
  reserveAddress: string;
  feePayerAddress: string;
  status: "reserved" | "submitted" | "review";
}

export interface SignedPayoutAttempt {
  jobId: string;
  reservationId: string;
  genesisHash: typeof DEVNET_GENESIS_HASH;
  bindingHash: string;
  transactionBase64: string;
  transactionHash: string;
  signature: string;
  blockhash: string;
  lastValidBlockHeight: number;
}

export interface PayoutJobStore {
  /** Must authorize job against durable reservation and immutable wallet entitlement. */
  loadAuthorizedJob(id: string): Promise<AuthorizedPayoutJob | null>;
  getSignedAttempt(jobId: string): Promise<SignedPayoutAttempt | null>;
  /** Atomic insert-if-absent keyed by job/reservation. Return winning persisted row.
   * Must durably commit before resolving. Never replace an existing signed attempt.
   */
  saveSignedAttemptIfAbsent(attempt: SignedPayoutAttempt): Promise<SignedPayoutAttempt>;
}

type PayoutConnection = Pick<Connection,
  "getGenesisHash" | "getLatestBlockhash" | "getBalance" | "getFeeForMessage" |
  "sendRawTransaction" | "getSignatureStatuses" | "getBlockHeight"
>;

export interface PayoutSignerOptions {
  enabled: boolean;
  reserve: Keypair;
  feePayer: Keypair;
  maxPayoutLamports: bigint;
  /** Operational cushion remains separate from holder entitlement. */
  minFeePayerBalanceLamports?: bigint;
}

function hash(bytes: string | Buffer): string { return createHash("sha256").update(bytes).digest("hex"); }

export function payoutBindingHash(job: AuthorizedPayoutJob): string {
  return hash(JSON.stringify([job.id, job.projectId, job.reservationId, job.network, job.asset, job.claimant,
    job.destination, job.amountLamports, job.reserveAddress, job.feePayerAddress]));
}

function validateJob(job: AuthorizedPayoutJob, maxAmount: bigint): bigint {
  if (job.network !== "devnet" || job.asset !== "SOL" || !job.id || !job.projectId || !job.reservationId ||
      !["reserved", "submitted", "review"].includes(job.status)) throw new Error("Authorized devnet SOL reservation required");
  if (!/^[1-9]\d*$/.test(job.amountLamports)) throw new Error("Payout amount must be canonical positive integer lamports");
  const amount = BigInt(job.amountLamports);
  if (amount < MIN_PAYOUT_LAMPORTS || amount > maxAmount || amount > 18_446_744_073_709_551_615n) throw new Error("Payout outside server amount limits");
  const destination = new PublicKey(job.destination);
  if (job.claimant !== job.destination || !PublicKey.isOnCurve(destination.toBytes())) throw new Error("Destination must equal authenticated claimant wallet");
  if (job.reserveAddress === job.feePayerAddress || job.destination === job.reserveAddress || job.destination === job.feePayerAddress) throw new Error("Reserve, fee payer and destination must be separate");
  new PublicKey(job.reserveAddress);
  new PublicKey(job.feePayerAddress);
  return amount;
}

/** Validate exact persisted wire bytes. Not a signing entry point. */
export function assertPayoutBinding(job: AuthorizedPayoutJob, attempt: SignedPayoutAttempt): Buffer {
  validateJob(job, 18_446_744_073_709_551_615n);
  if (attempt.jobId !== job.id || attempt.reservationId !== job.reservationId || attempt.genesisHash !== DEVNET_GENESIS_HASH ||
      attempt.bindingHash !== payoutBindingHash(job)) throw new Error("Signed payout differs from authorized reservation");
  const raw = Buffer.from(attempt.transactionBase64, "base64");
  if (raw.toString("base64") !== attempt.transactionBase64 || hash(raw) !== attempt.transactionHash) throw new Error("Signed payout bytes were changed");
  const tx = Transaction.from(raw);
  if (!tx.verifySignatures() || !tx.signature || bs58.encode(tx.signature) !== attempt.signature || tx.recentBlockhash !== attempt.blockhash ||
      !tx.feePayer?.equals(new PublicKey(job.feePayerAddress)) || !Number.isSafeInteger(attempt.lastValidBlockHeight) || attempt.lastValidBlockHeight <= 0 || tx.instructions.length !== 1) throw new Error("Invalid signed payout envelope");
  const instruction = tx.instructions[0];
  if (!instruction.programId.equals(SystemProgram.programId) || SystemInstruction.decodeInstructionType(instruction) !== "Transfer") throw new Error("Only bound SOL payout transfer allowed");
  const transfer = SystemInstruction.decodeTransfer(instruction);
  if (!transfer.fromPubkey.equals(new PublicKey(job.reserveAddress)) || !transfer.toPubkey.equals(new PublicKey(job.destination)) ||
      BigInt(transfer.lamports) !== BigInt(job.amountLamports) || instruction.keys.length !== 2) throw new Error("Payout destination, reserve or amount changed");
  return raw;
}

export type PayoutReconciliation =
  | { state: "finalized"; signature: string; slot: number }
  | { state: "failed"; signature: string; slot: number; error: unknown }
  | { state: "unknown"; signature: string; expired: boolean | null; reason: string };

/** Worker-only capability. Public methods take server job IDs, never destinations, amounts or instructions.
 * DB must reserve once, enforce worker leases, persist attempts append-only, and reconcile before release.
 */
export class DevnetPayoutSigner {
  constructor(private readonly connection: PayoutConnection, private readonly store: PayoutJobStore, private readonly options: PayoutSignerOptions) {
    assertServerRuntime();
    if (options.reserve.publicKey.equals(options.feePayer.publicKey)) throw new Error("Separate reserve and operational fee payer required");
    if (options.maxPayoutLamports < MIN_PAYOUT_LAMPORTS || options.maxPayoutLamports > 18_446_744_073_709_551_615n ||
        (options.minFeePayerBalanceLamports ?? 0n) < 0n) throw new Error("Invalid payout signer limits");
  }

  private async load(id: string) {
    assertServerRuntime();
    if (!this.options.enabled) throw new Error("Devnet payout signer disabled");
    await assertDevnet(this.connection);
    const job = await this.store.loadAuthorizedJob(id);
    if (!job || job.id !== id) throw new Error("Authorized payout reservation unavailable");
    validateJob(job, this.options.maxPayoutLamports);
    if (job.reserveAddress !== this.options.reserve.publicKey.toBase58() || job.feePayerAddress !== this.options.feePayer.publicKey.toBase58()) throw new Error("Job signer addresses differ from configured keys");
    return { ...job };
  }

  /** Signs fixed server job and commits envelope before returning. Does not broadcast. */
  async prepare(jobId: string): Promise<SignedPayoutAttempt> {
    const job = await this.load(jobId);
    const existing = await this.store.getSignedAttempt(jobId);
    if (existing) { assertPayoutBinding(job, existing); return existing; }
    if (job.status !== "reserved") throw new Error("Submitted or unknown payout may never be rebuilt");
    const latest = await this.connection.getLatestBlockhash("finalized");
    const tx = new Transaction({ ...latest, feePayer: this.options.feePayer.publicKey });
    tx.add(SystemProgram.transfer({ fromPubkey: this.options.reserve.publicKey, toPubkey: new PublicKey(job.destination), lamports: BigInt(job.amountLamports) }));
    const [reserveBalance, feeBalance, fee] = await Promise.all([
      this.connection.getBalance(this.options.reserve.publicKey, "finalized"),
      this.connection.getBalance(this.options.feePayer.publicKey, "finalized"),
      this.connection.getFeeForMessage(tx.compileMessage(), "finalized"),
    ]);
    if (![reserveBalance, feeBalance, fee.value].every((n) => n !== null && Number.isSafeInteger(n) && n >= 0)) throw new Error("Exact reserve balance or fee unavailable");
    if (BigInt(reserveBalance) < BigInt(job.amountLamports)) throw new Error("Insufficient payout reserve; keep reservation held");
    if (BigInt(feeBalance) < BigInt(fee.value!) + (this.options.minFeePayerBalanceLamports ?? 0n)) throw new Error("Insufficient operational fee payer balance");
    tx.sign(this.options.feePayer, this.options.reserve);
    const raw = tx.serialize();
    const attempt: SignedPayoutAttempt = {
      jobId, reservationId: job.reservationId, genesisHash: DEVNET_GENESIS_HASH,
      bindingHash: payoutBindingHash(job), transactionBase64: raw.toString("base64"), transactionHash: hash(raw),
      signature: bs58.encode(tx.signature!), ...latest,
    };
    assertPayoutBinding(job, attempt);
    const persisted = await this.store.saveSignedAttemptIfAbsent(attempt);
    assertPayoutBinding(job, persisted);
    return persisted;
  }

  /** Loads durable bytes, checks finality first, then sends ONLY those bytes. No rebuild on expiry. */
  async broadcast(jobId: string): Promise<{ state: "submitted"; signature: string } | PayoutReconciliation> {
    const job = await this.load(jobId);
    const attempt = await this.store.getSignedAttempt(jobId);
    if (!attempt) throw new Error("Persist signed payout before broadcast");
    const raw = assertPayoutBinding(job, attempt);
    const status = await this.reconcile(jobId);
    if (status.state !== "unknown" || status.expired !== false) return status;
    try {
      const signature = await this.connection.sendRawTransaction(raw, { skipPreflight: false, preflightCommitment: "finalized", maxRetries: 0 });
      if (signature !== attempt.signature) return { state: "unknown", signature: attempt.signature, expired: false, reason: "RPC returned unexpected signature; hold for review" };
      return { state: "submitted", signature };
    } catch {
      // A timeout or preflight error is NOT evidence that another broadcast did not land.
      return { state: "unknown", signature: attempt.signature, expired: null, reason: "Broadcast result unknown; reconcile persisted signature without replacing transaction" };
    }
  }

  async reconcile(jobId: string): Promise<PayoutReconciliation> {
    const job = await this.load(jobId);
    const attempt = await this.store.getSignedAttempt(jobId);
    if (!attempt) throw new Error("No persisted payout attempt to reconcile");
    assertPayoutBinding(job, attempt);
    try {
      const status = (await this.connection.getSignatureStatuses([attempt.signature], { searchTransactionHistory: true })).value[0];
      if (status?.confirmationStatus === "finalized") {
        if (status.err) return { state: "failed", signature: attempt.signature, slot: status.slot, error: status.err };
        return { state: "finalized", signature: attempt.signature, slot: status.slot };
      }
      const expired = await this.connection.getBlockHeight("finalized") > attempt.lastValidBlockHeight;
      return { state: "unknown", signature: attempt.signature, expired,
        reason: expired ? "Blockhash expired but non-execution not proven; keep reservation held for review" : "Not finalized; only identical-byte rebroadcast permitted" };
    } catch {
      return { state: "unknown", signature: attempt.signature, expired: null, reason: "RPC history unavailable; keep reservation held" };
    }
  }
}
