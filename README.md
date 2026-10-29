# weftcurve.fun

Creator and community launchpad prototype for Meteora-style curves. Every token selects one fee destination based on Mogz-style options.

## Current scope

- Full **local simulator**: create token, buy/sell, reward epoch, Claim, append-only journal, and synthetic payout receipt.
- **Fee destinations**: Creator, Holders, King of the Hill, Underwater Holders, Share with Wallets / Charities, or CTO on creator sell.
- **Devnet adapter**: explicit Solana devnet guard, Meteora DBC/DAMM v2 transaction preparation, immutable policy verification, safe snapshot support, and fee receipt verification.
- Mainnet is hard-blocked. No deployment, live funds, auto-trading, APY, staking, or production custody is included.

Simulator data is local only. It never proves a devnet transaction or production readiness.

## Fee destination rules

Normal curve trades use a 0.50% quote-token fee: 0.30% routes to the selected destination, 0.10% to the platform, and 0.10% to Meteora protocol. The destination does not add another fee. After graduation, no fixed 0.30% claim is made: rewards must come only from verified creator-side LP fee receipts.

| Destination | Simulator behavior |
|---|---|
| Creator | Full destination share to the creator. |
| Holders | Pro rata to eligible balances; original creator excluded. |
| King of the Hill | Largest recorded eligible single buy wins; earliest equal buy wins; a sale disqualifies the wallet. Token transfers are not simulated. |
| Underwater Holders | Pro rata to current holders whose recorded average entry is strictly above current simulator price. Transfer-only balances have no entry history. |
| Share with Wallets / Charities | Exact configured percentages across recipient wallets and simulator-only charity destinations. |
| CTO on creator sell | Starts as Creator. The first original-creator **sell through this simulator** permanently routes later destination fees to Holders. Pre-trigger accrued rewards stay with Creator. Transfers and off-platform sales are not observed. |

The current simulator supports all six modes. “Charity” means only one of three fixed simulator ledger destinations: Open Source Collective, Community Food Bank, or Ocean Cleanup Fund. No external organization, donate.gg, payment rail, or donation transaction is contacted or represented as real.

Current Mogz documentation leaves several details unspecified—such as post-launch policy-change effects, King measurement unit, partial-sale cost basis, and exact current-price source. weftcurve does not claim those simulator choices are identical to Mogz.

## Requirements

- macOS or Linux
- pnpm 10+
- Node 24 LTS recommended. This project installs a project-local Node runtime through `pnpm` when approved build scripts are enabled.

## Start locally

```bash
pnpm install
pnpm rebuild node esbuild @embedded-postgres/darwin-arm64 unrs-resolver
pnpm db:start
```

In separate terminals:

```bash
pnpm db:migrate
pnpm worker
pnpm dev
```

Open `http://localhost:3000`.

`pnpm db:start` runs PostgreSQL locally on `127.0.0.1:55432`. It creates separate simulator, test, and devnet databases. It does not require Docker. Keep its terminal running while using the app.

## Commands

| Command | Purpose |
|---|---|
| `pnpm dev` | Run the Next.js application on localhost |
| `pnpm worker` | Run the simulator reward worker; it settles local Claim requests |
| `pnpm db:start` | Start project-local PostgreSQL |
| `pnpm db:migrate` | Apply append-only ledger and application migrations |
| `pnpm test` | Run unit tests |
| `pnpm test:integration` | Run PostgreSQL-backed integration tests |
| `pnpm test:e2e` | Run browser tests after Playwright browsers are installed |
| `pnpm lint` | Run ESLint |
| `pnpm typecheck` | Run TypeScript checks |
| `pnpm build` | Build the web application |

## Local simulator workflow

1. Choose a test identity. Every identity starts with 10 simulated SOL.
2. Launch a token and select a fee destination.
3. Buy from a second identity.
4. Run a reward epoch from the token page.
5. Open Rewards and press Claim when a wallet reward meets the per-token minimum.
6. After the curve reaches 1 simulated SOL, migrate its simulator pool. It then appears under the **Graduated** Explore filter. This only means the local simulator marked migration active; it is not proof of a real DAMM v2 pool.

The simulator labels every action and payout as simulated. It does not create a Solana transaction, a valid explorer link, or a real wallet balance.

## Reward accounting rules

- Amounts are raw integer units; no floating-point money math.
- Epochs snapshot balances. The original creator, pool/vault accounts, platform accounts, and configured burn accounts are excluded where relevant.
- Reward dust and rewards with no eligible recipient carry to the next epoch for the same pool.
- A Claim reserves a wallet entitlement before the worker processes it. Repeated clicks do not generate a second payout.
- Charity simulator entries never become claimable external payouts.

## Devnet is opt-in and incomplete by default

The user interface keeps devnet operations disabled until every required variable and server-only key exists:

```dotenv
APP_NETWORK=devnet
DATABASE_URL=postgresql://weft:weft-local-only@127.0.0.1:55432/weftcurve_devnet
SOLANA_RPC_URL=https://api.devnet.solana.com
NEXT_PUBLIC_SOLANA_RPC_URL=https://api.devnet.solana.com
ENABLE_DEVNET_TRANSACTIONS=true
DEVNET_PARTNER_PUBLIC_KEY=<separate partner fee-claimer public key>
DEVNET_KEYS_DIR=/absolute/private/devnet-project-keys
```

Devnet creator launch is the only destination mode that may proceed. Holders, King of the Hill, Underwater Holders, Share, and CTO stay **simulator-only** until verified distribution and creator-sale monitoring infrastructure exists. Payouts require additional explicit configuration (`ENABLE_DEVNET_REWARDS`, a separate reserve, and separate fee payer), reconciliation, and operational review. Do not set those values until the signer and custody process has been independently reviewed.

Never place seed phrases or private keys in `.env`, browser storage, source files, logs, or Git. `DEVNET_KEYS_DIR` must be outside this repository and accessible only to the server account.

## Production gates

This prototype is **not production-ready**. Before any mainnet or real-fund operation:

- independent smart-contract, signer, and accounting review;
- documented custody, reserve, recovery, and incident operations;
- legal review for intended jurisdictions;
- full devnet integration tests covering Meteora configuration, migration, fee claims, snapshots, payout retries, and explorer reconciliation;
- verified holder distributor and donation integration, or a separate policy that removes those modes;
- explicit mainnet approval.
