export type RewardMode = "creator" | "holders" | "king_of_hill" | "underwater" | "share" | "cto_on_creator_sell" | "legacy_split";
export type RecipientKind = "wallet" | "charity";
export interface RewardRecipient { id:string; label:string; kind:RecipientKind; wallet:string; shareBps:number; }
export type Network = "simulator" | "devnet";
export type ProjectStatus = "bonding" | "migration_pending" | "graduated";
export interface Project {
  id: string;
  mint: string;
  name: string;
  symbol: string;
  description: string;
  image: string | null;
  mode: RewardMode;
  /** CTO rule state: false routes to creator; true permanently routes new destination fees to Holders. */
  ctoActive: boolean;
  ctoTriggeredAt: string | null;
  holderShareBps: number;
  recipients: RewardRecipient[];
  creator: string;
  network: Network;
  status: ProjectStatus;
  createdAt: string;
  supply: string;
  reserve: string;
  volume: string;
  creatorFees: string;
  distributed: string;
  holderCount: number;
  tokenReserve: string;
  policyHash: string;
}
export interface RewardBalance {
  projectId: string;
  available: string;
  reserved: string;
  paid: string;
}
export interface Activity {
  id: string;
  projectId: string;
  wallet: string;
  type: "buy" | "sell" | "distribution" | "claim" | "payout" | "launch" | "migration" | "cto_trigger";
  amount: string;
  signature: string | null;
  createdAt: string;
}
export interface Claim {
  id: string;
  projectId: string;
  wallet: string;
  amount: string;
  status: "reserved" | "submitted" | "finalized" | "review";
  signature: string | null;
  createdAt: string;
}
export interface AppState {
  network: Network;
  wallet: string | null;
  walletLabel: string | null;
  csrf: string | null;
  projects: Project[];
  rewards: RewardBalance[];
  claims: Claim[];
  activity: Activity[];
  holdings: Record<string, string>;
  balance: string;
  worker: { lastRun: string | null; pending: number };
  capabilities: { launch: boolean; trade: boolean; claim: boolean; reason: string | null };
}
export interface ApiError { error: string; code?: string }
