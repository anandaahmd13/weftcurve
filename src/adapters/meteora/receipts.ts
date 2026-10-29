import bs58 from "bs58";
import { PublicKey, Transaction, TransactionInstruction, type Connection } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, NATIVE_MINT, TOKEN_PROGRAM_ID, decodeCloseAccountInstruction, decodeTransferCheckedInstruction, decodeTransferInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { DAMM_V2_PROGRAM_ID, DYNAMIC_BONDING_CURVE_PROGRAM_ID, deriveDbcPoolAuthority } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { derivePoolAuthority } from "@meteora-ag/cp-amm-sdk";
import { assertDevnet, assertExecutablePrograms } from "./guard";
import { assertServerRuntime } from "../../server/signing/runtime";

const DBC_CLAIM = Buffer.from([82, 220, 250, 189, 3, 85, 107, 45]);
const DAMM_CLAIM = Buffer.from([180, 38, 154, 17, 133, 33, 162, 211]);
const DBC_EVENT = Buffer.from([154, 228, 215, 202, 133, 155, 214, 138]);
const DAMM_EVENT = Buffer.from([198, 182, 183, 52, 97, 12, 49, 56]);
// Anchor 0.31 event.rs EVENT_IX_TAG=0x1d9acb512ea545e4, serialized little-endian.
const EVENT_CPI = Buffer.from("e445a52e51cb9a1d", "hex");

/** Persisted by trusted collection worker after SDK construction and structured authorization.
 * Never build this record from an arbitrary client-submitted transaction/signature.
 */
export interface CollectOperation {
  id: string;
  projectId: string;
  network: "devnet";
  kind: "dbc-creator" | "damm-position";
  signature: string;
  transactionBase64: string;
  pool: string;
  baseMint: string;
  baseVault: string;
  quoteVault: string;
  collector: string;
  receiver: string;
  feePayer: string;
  position?: string;
  positionNftAccount?: string;
}

export interface CollectOperationStore {
  loadCollectOperation(id: string): Promise<CollectOperation | null>;
}
export interface VerifiedFeeReceipt {
  id: string;
  operationId: string;
  projectId: string;
  network: "devnet";
  asset: "SOL";
  signature: string;
  instructionIndex: number;
  slot: number;
  pool: string;
  position: string | null;
  receiver: string;
  amountLamports: string;
  source: "dbc-creator" | "damm-position";
}

type ReceiptConnection = Pick<Connection, "getGenesisHash" | "getMultipleAccountsInfo" | "getTransaction">;
const key = (value: string) => new PublicKey(value);
const same = (actual: PublicKey | undefined, expected: PublicKey) => actual?.equals(expected) === true;
function requireMatch(ok: boolean, message: string): asserts ok { if (!ok) throw new Error(`Fee receipt rejected: ${message}`); }

/** No caller-controlled transaction input: operation ID resolves trusted server state.
 * Missing events/CPI trace means review, never estimated rewards. Returns event amount, NOT SOL delta.
 */
export async function verifyCollectedFee(connection: ReceiptConnection, store: CollectOperationStore, operationId: string): Promise<VerifiedFeeReceipt> {
  assertServerRuntime();
  await assertDevnet(connection);
  const op = await store.loadCollectOperation(operationId);
  requireMatch(!!op && op.id === operationId && op.network === "devnet" && !!op.projectId, "trusted collection operation unavailable");
  const isDbc = op.kind === "dbc-creator";
  requireMatch(isDbc || op.kind === "damm-position", "unknown fee source");
  const program = isDbc ? DYNAMIC_BONDING_CURVE_PROGRAM_ID : DAMM_V2_PROGRAM_ID;
  const authority = isDbc ? deriveDbcPoolAuthority() : derivePoolAuthority();
  await assertExecutablePrograms(connection, [program, TOKEN_PROGRAM_ID]);
  const expectedRaw = Buffer.from(op.transactionBase64, "base64");
  requireMatch(expectedRaw.toString("base64") === op.transactionBase64, "noncanonical transaction bytes");
  const expected = Transaction.from(expectedRaw);
  requireMatch(expected.verifySignatures() && !!expected.signature && bs58.encode(expected.signature) === op.signature, "persisted transaction not fully signed");
  requireMatch(same(expected.feePayer, key(op.feePayer)), "fee payer mismatch");
  const tx = await connection.getTransaction(op.signature, { commitment: "finalized", maxSupportedTransactionVersion: 0 });
  requireMatch(!!tx && !!tx.meta && tx.meta.err === null, "transaction missing, not finalized, or failed");
  requireMatch(Buffer.from(tx.transaction.message.serialize()).equals(expected.serializeMessage()), "finalized message differs from persisted transaction");
  requireMatch(JSON.stringify(tx.transaction.signatures) === JSON.stringify(expected.signatures.map((s) => s.signature ? bs58.encode(s.signature) : null)), "finalized signatures differ");
  const collector = key(op.collector), receiver = key(op.receiver), baseMint = key(op.baseMint);
  const quoteAta = getAssociatedTokenAddressSync(NATIVE_MINT, collector, true);
  const baseAta = getAssociatedTokenAddressSync(baseMint, receiver, true);
  const claimIndices = expected.instructions.flatMap((ix, index) => ix.programId.equals(program) ? [index] : []);
  requireMatch(claimIndices.length === 1, "exactly one claim instruction required");
  const index = claimIndices[0], claim = expected.instructions[index];
  const discriminator = isDbc ? DBC_CLAIM : DAMM_CLAIM;
  requireMatch(claim.data.subarray(0, 8).equals(discriminator) && claim.data.length === (isDbc ? 24 : 8), "not an allowed fee claim");
  if (isDbc) requireMatch(claim.data.readBigUInt64LE(8) === 0n, "base-token claim unsupported");
  const eventAuthority = PublicKey.findProgramAddressSync([Buffer.from("__event_authority")], program)[0];
  const expectedAccounts = isDbc
    ? [authority, key(op.pool), baseAta, quoteAta, key(op.baseVault), key(op.quoteVault), baseMint, NATIVE_MINT, collector, TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, eventAuthority, program]
    : [authority, key(op.pool), key(op.position ?? ""), baseAta, quoteAta, key(op.baseVault), key(op.quoteVault), baseMint, NATIVE_MINT, key(op.positionNftAccount ?? ""), collector, TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, eventAuthority, program];
  requireMatch(claim.keys.length === expectedAccounts.length && claim.keys.every((k, i) => k.pubkey.equals(expectedAccounts[i])), "claim account routing mismatch");
  requireMatch(claim.keys[isDbc ? 8 : 10].isSigner, "collector must sign claim");
  let closeCount = 0;
  for (let i = 0; i < expected.instructions.length; i++) {
    if (i === index) continue;
    const ix = expected.instructions[i];
    if (ix.programId.equals(TOKEN_PROGRAM_ID)) {
      const close = decodeCloseAccountInstruction(ix);
      requireMatch(i > index && close.keys.account.pubkey.equals(quoteAta) && close.keys.destination.pubkey.equals(receiver) && close.keys.authority.pubkey.equals(collector), "SOL unwrap receiver mismatch");
      closeCount++;
    } else if (ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) {
      requireMatch(i < index && (ix.data.length === 0 || (ix.data.length === 1 && ix.data[0] === 1)) &&
        ((same(ix.keys[1]?.pubkey, quoteAta) && same(ix.keys[2]?.pubkey, collector) && same(ix.keys[3]?.pubkey, NATIVE_MINT)) ||
         (same(ix.keys[1]?.pubkey, baseAta) && same(ix.keys[2]?.pubkey, receiver) && same(ix.keys[3]?.pubkey, baseMint))), "unexpected ATA setup");
    } else throw new Error("Fee receipt rejected: unrelated top-level instruction");
  }
  requireMatch(closeCount === 1, "exactly one bound SOL unwrap required");
  const groups = tx.meta.innerInstructions?.filter((group) => group.index === index) ?? [];
  requireMatch(groups.length === 1, "claim CPI trace missing or duplicated");
  // Expected message is legacy (SDK builder). Exact message equality excludes LUT/account substitution.
  const keys = expected.compileMessage().accountKeys;
  let eventAmount: bigint | null = null;
  let transferred = 0n;
  let transferCount = 0;
  for (const ix of groups[0].instructions) {
    const invoked = keys[ix.programIdIndex];
    const bytes = Buffer.from(bs58.decode(ix.data));
    if (invoked?.equals(program)) {
      requireMatch(bytes.subarray(0, 8).equals(EVENT_CPI), "unexpected self-CPI");
      const eventTag = isDbc ? DBC_EVENT : DAMM_EVENT;
      requireMatch(eventAmount === null && bytes.subarray(8, 16).equals(eventTag) && bytes.length === (isDbc ? 64 : 128), "duplicate or unexpected fee event");
      requireMatch(ix.accounts.length === 1 && same(keys[ix.accounts[0]], eventAuthority), "event authority provenance mismatch");
      requireMatch(new PublicKey(bytes.subarray(16, 48)).equals(key(op.pool)), "event pool mismatch");
      if (isDbc) {
        requireMatch(bytes.readBigUInt64LE(48) === 0n, "unexpected base fee");
        eventAmount = bytes.readBigUInt64LE(56);
      } else {
        requireMatch(new PublicKey(bytes.subarray(48, 80)).equals(key(op.position!)) && new PublicKey(bytes.subarray(80, 112)).equals(collector), "event position or owner mismatch");
        requireMatch(bytes.readBigUInt64LE(112) === 0n, "unexpected base fee");
        eventAmount = bytes.readBigUInt64LE(120);
      }
    } else if (invoked?.equals(TOKEN_PROGRAM_ID)) {
      const instruction = new TransactionInstruction({ programId: TOKEN_PROGRAM_ID, data: bytes,
        keys: ix.accounts.map((i) => ({ pubkey: keys[i], isSigner: false, isWritable: false })) });
      requireMatch(bytes[0] === 3 || bytes[0] === 12, "unexpected token CPI");
      const transfer = bytes[0] === 12 ? decodeTransferCheckedInstruction(instruction) : decodeTransferInstruction(instruction);
      const value = transfer.data.amount;
      if ("mint" in transfer.keys) requireMatch(transfer.keys.mint.pubkey.equals(NATIVE_MINT) && "decimals" in transfer.data && transfer.data.decimals === 9, "transfer mint mismatch");
      requireMatch(transfer.keys.source.pubkey.equals(key(op.quoteVault)) && transfer.keys.destination.pubkey.equals(quoteAta) && transfer.keys.owner.pubkey.equals(authority), "fee transfer source or destination mismatch");
      transferred += value;
      transferCount++;
    } else throw new Error("Fee receipt rejected: unrelated claim CPI program");
  }
  requireMatch(eventAmount !== null && eventAmount > 0n && transferCount === 1 && transferred === eventAmount, "event fee does not match actual quote transfer");
  return { id: `devnet:${op.signature}:${index}`, operationId, projectId: op.projectId, network: "devnet", asset: "SOL",
    signature: op.signature, instructionIndex: index, slot: tx.slot, pool: op.pool, position: op.position ?? null,
    receiver: op.receiver, amountLamports: eventAmount.toString(), source: op.kind };
}
