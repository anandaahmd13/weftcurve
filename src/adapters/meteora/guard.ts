import { PublicKey, type Connection } from "@solana/web3.js";
import { DYNAMIC_BONDING_CURVE_PROGRAM_ID, DAMM_V2_PROGRAM_ID, METAPLEX_PROGRAM_ID } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";

// Verified against https://api.devnet.solana.com getGenesisHash (2026-10-28).
// This is NOT the testnet hash 4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY.
export const DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export const METEORA_REQUIRED_PROGRAMS = [
  DYNAMIC_BONDING_CURVE_PROGRAM_ID, DAMM_V2_PROGRAM_ID, METAPLEX_PROGRAM_ID,
  TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
] as const;

export class DevnetCapabilityError extends Error {
  readonly code = "DEVNET_UNAVAILABLE";
}

export type GuardConnection = Pick<Connection, "getGenesisHash" | "getMultipleAccountsInfo">;

export async function assertDevnet(connection: Pick<Connection, "getGenesisHash">): Promise<void> {
  if (await connection.getGenesisHash() !== DEVNET_GENESIS_HASH) {
    throw new DevnetCapabilityError("RPC genesis is not Solana devnet; operation refused");
  }
}

export async function assertExecutablePrograms(
  connection: Pick<Connection, "getMultipleAccountsInfo">,
  programs: readonly PublicKey[] = METEORA_REQUIRED_PROGRAMS,
): Promise<void> {
  const accounts = await connection.getMultipleAccountsInfo([...programs], "finalized");
  if (accounts.length !== programs.length) throw new DevnetCapabilityError("Incomplete program account response");
  for (let i = 0; i < programs.length; i++) {
    if (!accounts[i]?.executable) throw new DevnetCapabilityError(`Required program unavailable: ${programs[i].toBase58()}`);
  }
}

export type MeteoraCapability = {
  enabled: boolean;
  network: "devnet";
  reason: string | null;
};

/** Capability is deliberately false without explicit server configuration, even if RPC exists. */
export async function inspectMeteoraCapability(
  connection: GuardConnection | null,
  explicitlyEnabled = false,
): Promise<MeteoraCapability> {
  if (!explicitlyEnabled || !connection) return { enabled: false, network: "devnet", reason: "Meteora devnet not configured" };
  try {
    await assertDevnet(connection);
    await assertExecutablePrograms(connection);
    return { enabled: true, network: "devnet", reason: null };
  } catch (error) {
    return { enabled: false, network: "devnet", reason: error instanceof Error ? error.message : "Devnet capability check failed" };
  }
}
