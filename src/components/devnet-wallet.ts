import type { Transaction } from "@solana/web3.js";

interface InjectedWallet {
  publicKey?: { toBase58(): string } | null;
  connect(): Promise<{ publicKey: { toBase58(): string } }>;
  signMessage(message: Uint8Array, display?: string): Promise<{ signature: Uint8Array }>;
  signTransaction(transaction: Transaction): Promise<Transaction>;
}

type WalletWindow = Window & {
  phantom?: { solana?: InjectedWallet };
  solflare?: InjectedWallet;
  solana?: InjectedWallet;
};

function provider(): InjectedWallet {
  const injected = window as WalletWindow;
  const wallet = injected.phantom?.solana || injected.solflare || injected.solana;
  if (!wallet?.connect || !wallet.signMessage || !wallet.signTransaction) throw new Error("No compatible wallet found. Open Phantom or Solflare to test on devnet.");
  return wallet;
}

export async function connectDevnetWallet(): Promise<string> {
  const connected = await provider().connect();
  return connected.publicKey.toBase58();
}

export async function signLoginMessage(message: string, expectedWallet: string): Promise<string> {
  const wallet = provider();
  if (wallet.publicKey?.toBase58() !== expectedWallet) throw new Error("Wallet changed. Sign in again with the correct address.");
  const { signature } = await wallet.signMessage(new TextEncoder().encode(message), "utf8");
  const { default: bs58 } = await import("bs58");
  return bs58.encode(signature);
}

export async function signAndSendDevnet(transactionBase64: string, expectedWallet: string): Promise<string> {
  const { Connection, Transaction } = await import("@solana/web3.js");
  const rpc = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com";
  const connection = new Connection(rpc, "finalized");
  const genesis = await connection.getGenesisHash();
  if (genesis !== "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG") throw new Error("This RPC is not Solana devnet. Signing was blocked.");
  const wallet = provider();
  if (wallet.publicKey?.toBase58() !== expectedWallet) throw new Error("Wallet does not match the active session. Sign in again before signing.");
  const bytes = Uint8Array.from(atob(transactionBase64), (character) => character.charCodeAt(0));
  const transaction = Transaction.from(bytes);
  const signed = await wallet.signTransaction(transaction);
  let signature: string;
  try {
    signature = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false, maxRetries: 3 });
  } catch {
    throw new Error("Submission result is unknown. Check your wallet and transaction before making another request.");
  }
  try {
    const result = await connection.confirmTransaction(signature, "finalized");
    if (result.value.err) throw new Error("Transaction was rejected by the network.");
  } catch {
    throw new Error(`Finality is not confirmed. Do not resubmit; inspect signature ${signature}.`);
  }
  return signature;
}
