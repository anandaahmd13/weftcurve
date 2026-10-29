import BN from "bn.js";
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { NATIVE_MINT, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, getAccount, getMint } from "@solana/spl-token";
import {
  DynamicBondingCurveClient, DYNAMIC_BONDING_CURVE_PROGRAM_ID, DAMM_V2_PROGRAM_ID,
  DAMM_V2_MIGRATION_FEE_ADDRESS, CollectFeeMode, SwapMode, MigrationFeeOption,
  MigrationOption, MigratedCollectFeeMode, TokenType, deriveDbcPoolAddress,
  deriveDbcPoolAuthority, deriveDammV2PoolAddress, getCurrentPoint,
  type PoolConfig, type VirtualPool,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import {
  CpAmm, SwapMode as DammSwapMode, derivePoolAuthority, derivePositionAddress,
  derivePositionNftAccount, deriveTokenVaultAddress, getBaseFeeHandlerFromPodAlignedData,
  type PoolState,
} from "@meteora-ag/cp-amm-sdk";
import { assertDevnet, assertExecutablePrograms, DevnetCapabilityError, inspectMeteoraCapability } from "./guard";
import { buildLaunchTemplate, EXPECTED_DAMM_COLLECT_FEE_MODE, TOKEN_SUPPLY_RAW } from "./template";
import { assertServerRuntime } from "../../server/signing/runtime";

export interface LaunchIntent {
  id: string;
  network: "devnet";
  status: "authorized";
  // Current DBC has no native arbitrary-holder distributor. Creator is on-chain;
  // non-creator modes are recorded policy labels and stay blocked until a verified distributor is wired.
  mode: "creator" | "holders" | "king_of_hill" | "underwater" | "share" | "cto_on_creator_sell";
  holderShareBps: number;
  recipients: readonly { id:string; label:string; kind:"wallet"|"charity"; wallet:string; shareBps:number }[];
  originalCreator: string;
  payer: string;
  poolCreator: string;
  partnerFeeClaimer: string;
  leftoverReceiver: string;
  mint: string;
  config: string;
  name: string;
  symbol: string;
  uri: string;
}

export interface MeteoraAdapterOptions {
  enabled?: boolean;
  /** Trusted server DB loader. Must return only persisted, authorized launch intents. */
  loadLaunchIntent?: (id: string) => Promise<LaunchIntent | null>;
}

export interface PreparedTransaction {
  transactionBase64: string;
  blockhash: string;
  lastValidBlockHeight: number;
  requiredSigners: string[];
}

export interface LaunchSigners {
  config: Keypair;
  mint: Keypair;
  collector?: Keypair;
}

export function validateLaunchIntent(intent: LaunchIntent): void {
  if (!intent.id || intent.network !== "devnet" || intent.status !== "authorized") throw new Error("Authorized persisted devnet intent required");
  if (!['creator', 'holders', 'king_of_hill', 'underwater', 'share', 'cto_on_creator_sell'].includes(intent.mode)) throw new Error('Invalid reward mode');
  if (!Number.isInteger(intent.holderShareBps) || intent.holderShareBps !== 0) throw new Error('Destination policy must not use a synthetic holder split');
  if (intent.mode === 'share' && (!intent.recipients.length || intent.recipients.reduce((sum, recipient) => sum + recipient.shareBps, 0) !== 10_000)) throw new Error('Share recipients must total exactly 100%');
  if (intent.mode !== 'share' && intent.recipients.length) throw new Error('Only Share mode may include recipients');
  for (const key of [intent.originalCreator, intent.payer, intent.poolCreator, intent.partnerFeeClaimer, intent.leftoverReceiver, intent.mint, intent.config]) new PublicKey(key);
  if (intent.payer !== intent.originalCreator) throw new Error("Launch payer must be original creator");
  if (intent.mode === "creator" ? intent.poolCreator !== intent.originalCreator : intent.poolCreator === intent.originalCreator) throw new Error("Pool creator does not match reward custody mode");
  if (intent.poolCreator === intent.partnerFeeClaimer) throw new Error("Partner fee claimer must be separate from creator-side authority");
  if (!intent.name.trim() || Buffer.byteLength(intent.name) > 32 || !intent.symbol.trim() || Buffer.byteLength(intent.symbol) > 10 ||
      Buffer.byteLength(intent.uri) > 200 || !/^https?:\/\//.test(intent.uri)) throw new Error("Invalid token metadata");
}

function amount(value: bigint): BN {
  if (value <= 0n || value > 18_446_744_073_709_551_615n) throw new Error("Amount must be positive u64 integer");
  return new BN(value.toString());
}

function assertSlippage(bps: number): void {
  if (!Number.isInteger(bps) || bps < 0 || bps > 1_000) throw new Error("Slippage must be integer 0–1000 bps");
}

/** Server-only SDK adapter. No broadcast, arbitrary signing, surplus, or authority-transfer API. */
export class MeteoraDevnetAdapter {
  private readonly dbc: DynamicBondingCurveClient;
  private readonly damm: CpAmm;

  constructor(private readonly connection: Connection, private readonly options: MeteoraAdapterOptions = {}) {
    assertServerRuntime();
    if (connection.commitment !== "finalized") throw new Error("Adapter connection must use finalized commitment");
    this.dbc = new DynamicBondingCurveClient(connection, "finalized");
    this.damm = new CpAmm(connection);
  }

  capability() { return inspectMeteoraCapability(this.connection, this.options.enabled === true); }

  private async guard(): Promise<void> {
    if (this.options.enabled !== true) throw new DevnetCapabilityError("Meteora devnet not explicitly enabled");
    await assertDevnet(this.connection);
    await assertExecutablePrograms(this.connection);
  }

  private async prepare(tx: Transaction, payer: PublicKey, signers: readonly Keypair[] = []): Promise<PreparedTransaction> {
    const latest = await this.connection.getLatestBlockhash("finalized");
    tx.feePayer = payer;
    tx.recentBlockhash = latest.blockhash;
    tx.lastValidBlockHeight = latest.lastValidBlockHeight;
    if (signers.length) tx.partialSign(...signers);
    const message = tx.compileMessage();
    return {
      transactionBase64: tx.serialize({ requireAllSignatures: false, verifySignatures: true }).toString("base64"),
      ...latest,
      requiredSigners: message.accountKeys.slice(0, message.header.numRequiredSignatures).map((key) => key.toBase58()),
    };
  }

  async prepareLaunch(intentId: string, signers?: LaunchSigners) {
    await this.guard();
    const intent = await this.options.loadLaunchIntent?.(intentId);
    if (!intent || intent.id !== intentId) throw new Error("Persisted authorized launch intent unavailable");
    validateLaunchIntent(intent);
    const keys = { config: new PublicKey(intent.config), mint: new PublicKey(intent.mint), payer: new PublicKey(intent.payer), creator: new PublicKey(intent.poolCreator) };
    const actualSigners: Keypair[] = [];
    if (signers) {
      if (!signers.config.publicKey.equals(keys.config) || !signers.mint.publicKey.equals(keys.mint)) throw new Error("Launch keys differ from persisted intent");
      actualSigners.push(signers.config, signers.mint);
      if (intent.mode !== "creator") {
        if (!signers.collector?.publicKey.equals(keys.creator)) throw new Error("Project collector signer required");
        actualSigners.push(signers.collector);
      } else if (signers.collector) throw new Error("Creator launch may not use a platform collector signer");
    }
    const config = buildLaunchTemplate(new PublicKey(intent.leftoverReceiver));
    const tx = await this.dbc.partner.createConfigAndPool({
      ...config, config: keys.config, payer: keys.payer, quoteMint: NATIVE_MINT,
      feeClaimer: new PublicKey(intent.partnerFeeClaimer), leftoverReceiver: new PublicKey(intent.leftoverReceiver),
      transferFeeParameters: null,
      preCreatePoolParam: { name: intent.name, symbol: intent.symbol, uri: intent.uri, poolCreator: keys.creator, baseMint: keys.mint },
    });
    return { ...await this.prepare(tx, keys.payer, actualSigners), intentId,
      pool: deriveDbcPoolAddress(NATIVE_MINT, keys.mint, keys.config).toBase58(), mint: intent.mint, config: intent.config };
  }

  async readCurve(pool: PublicKey): Promise<{ pool: VirtualPool; config: PoolConfig }> {
    await this.guard();
    const found = await this.dbc.state.getPoolWithKind(pool);
    if (!found || found.isTransferHookPool) throw new Error("Classic DBC pool unavailable");
    const config = await this.dbc.state.getPoolConfig(found.virtualPool.poolState.config);
    if (!config || config.tokenType !== TokenType.SPLToken || !config.quoteMint.equals(NATIVE_MINT) || config.quoteTokenFlag !== TokenType.SPLToken || config.transferFeeFlag !== 0) throw new Error("Unsupported pool token policy");
    return { pool: found.virtualPool, config };
  }

  /** Call before marking a newly created intent active. Does not trust browser signatures. */
  async verifyLaunch(intentId: string) {
    const intent = await this.options.loadLaunchIntent?.(intentId);
    if (!intent || intent.id !== intentId) throw new Error("Launch intent unavailable");
    validateLaunchIntent(intent);
    const address = deriveDbcPoolAddress(NATIVE_MINT, new PublicKey(intent.mint), new PublicKey(intent.config));
    const state = await this.readCurve(address);
    const { config, pool } = state;
    const expected = buildLaunchTemplate(new PublicKey(intent.leftoverReceiver));
    const fixed = config.poolFees.baseFee;
    if (!pool.poolState.creator.equals(new PublicKey(intent.poolCreator)) || !pool.poolState.baseMint.equals(new PublicKey(intent.mint)) ||
        !config.feeClaimer.equals(new PublicKey(intent.partnerFeeClaimer)) || !config.leftoverReceiver.equals(new PublicKey(intent.leftoverReceiver)) ||
        config.collectFeeMode !== CollectFeeMode.QuoteToken || config.creatorTradingFeePercentage !== 75 || config.tokenDecimal !== 6 ||
        config.migrationOption !== MigrationOption.MET_DAMM_V2 || config.migrationFeeOption !== MigrationFeeOption.Customizable ||
        config.partnerPermanentLockedLiquidityPercentage !== 50 || config.creatorPermanentLockedLiquidityPercentage !== 50 ||
        config.partnerLiquidityPercentage !== 0 || config.creatorLiquidityPercentage !== 0 ||
        config.migrationFeePercentage !== 0 || config.creatorMigrationFeePercentage !== 0 || !config.poolCreationFee.isZero() ||
        config.migratedCollectFeeMode !== MigratedCollectFeeMode.QuoteToken || config.migratedPoolFeeBps !== 50 ||
        config.migratedDynamicFee !== 0 || config.migratedCompoundingFeeBps !== 0 || config.poolFees.dynamicFee.initialized !== 0 ||
        !fixed.cliffFeeNumerator.eq(new BN(5_000_000)) || fixed.firstFactor !== 0 || !fixed.secondFactor.isZero() || !fixed.thirdFactor.isZero() ||
        !config.migrationQuoteThreshold.eq(expected.migrationQuoteThreshold) || !config.sqrtStartPrice.eq(expected.sqrtStartPrice) ||
        config.enableFirstSwapWithMinFee !== 0 || config.tokenUpdateAuthority !== expected.tokenUpdateAuthority ||
        config.activationType !== expected.activationType || fixed.baseFeeMode !== expected.poolFees.baseFee.baseFeeMode ||
        config.migratedPoolBaseFeeMode !== expected.migratedPoolBaseFeeMode || config.fixedTokenSupplyFlag !== 1 ||
        config.partnerLiquidityVestingInfo.vestingPercentage !== 0 || config.creatorLiquidityVestingInfo.vestingPercentage !== 0 ||
        !config.lockedVestingConfig.amountPerPeriod.isZero() || !config.lockedVestingConfig.cliffUnlockAmount.isZero() ||
        config.curve.length < expected.curve.length || !pool.poolState.config.equals(new PublicKey(intent.config)) ||
        config.preMigrationTokenSupply.toString() !== TOKEN_SUPPLY_RAW.toString() || config.postMigrationTokenSupply.toString() !== TOKEN_SUPPLY_RAW.toString()) {
      throw new Error("On-chain launch configuration does not match approved template");
    }
    for (let i = 0; i < config.curve.length; i++) {
      const actual = config.curve[i], target = expected.curve[i];
      if (target ? !actual.sqrtPrice.eq(target.sqrtPrice) || !actual.liquidity.eq(target.liquidity) : !actual.sqrtPrice.isZero() || !actual.liquidity.isZero()) throw new Error("On-chain curve differs from template");
    }
    const mint = await getMint(this.connection, new PublicKey(intent.mint), "finalized", TOKEN_PROGRAM_ID);
    if (mint.supply !== TOKEN_SUPPLY_RAW || mint.decimals !== 6 || mint.mintAuthority !== null || mint.freezeAuthority !== null) throw new Error("Mint supply or authorities do not match launch");
    return { ...state, mint, address };
  }

  async quoteCurveSwap(poolAddress: PublicKey, amountIn: bigint, swapBaseForQuote: boolean, slippageBps: number) {
    assertSlippage(slippageBps);
    const { pool, config } = await this.readCurve(poolAddress);
    if (pool.poolState.isMigrated || pool.poolState.quoteReserve.gte(config.migrationQuoteThreshold)) throw new Error("Curve completed; verify DAMM migration before trading");
    const currentPoint = await getCurrentPoint(this.connection, config.activationType);
    const quote = this.dbc.pool.swapQuote2({ virtualPool: pool, config, amountIn: amount(amountIn), swapMode: SwapMode.ExactIn,
      swapBaseForQuote, hasReferral: false, eligibleForFirstSwapWithMinFee: false, currentPoint, slippageBps });
    return { quote, pool: poolAddress.toBase58(), amountIn: amountIn.toString(), swapBaseForQuote, slippageBps, expiresAt: Date.now() + 30_000 };
  }

  async prepareCurveSwap(input: { pool: PublicKey; owner: PublicKey; amountIn: bigint; minimumAmountOut: bigint; swapBaseForQuote: boolean; expiresAt: number }) {
    if (input.expiresAt <= Date.now() || input.expiresAt > Date.now() + 60_000) throw new Error("Swap quote expired or invalid");
    await this.readCurve(input.pool);
    const tx = await this.dbc.pool.swap2({ pool: input.pool, owner: input.owner, amountIn: amount(input.amountIn), minimumAmountOut: amount(input.minimumAmountOut), swapBaseForQuote: input.swapBaseForQuote, swapMode: SwapMode.ExactIn, referralTokenAccount: null });
    return this.prepare(tx, input.owner);
  }

  /** Equivalent to SDK migrateToDammV2, but accepts persisted NFT mints instead of generating secrets.
   * Uses the published SDK IDL and PDA helpers, not copied curve math. Unsigned only.
   */
  async prepareMigration(input: { pool: PublicKey; payer: PublicKey; firstPositionNftMint: PublicKey; secondPositionNftMint: PublicKey }) {
    const { pool, config } = await this.readCurve(input.pool);
    if (pool.poolState.isMigrated || pool.poolState.quoteReserve.lt(config.migrationQuoteThreshold)) throw new Error("Pool not eligible for migration");
    if (config.migrationFeeOption !== MigrationFeeOption.Customizable || config.migratedPoolFeeBps !== 50 || config.migratedCollectFeeMode !== MigratedCollectFeeMode.QuoteToken) throw new Error("Unsupported migration configuration");
    if (input.firstPositionNftMint.equals(input.secondPositionNftMint)) throw new Error("Distinct persisted position NFT mints required");
    const dammConfig = DAMM_V2_MIGRATION_FEE_ADDRESS[MigrationFeeOption.Customizable];
    const configAccount = await this.connection.getAccountInfo(dammConfig, "finalized");
    if (!configAccount?.owner.equals(DAMM_V2_PROGRAM_ID)) throw new DevnetCapabilityError("Customizable DAMM migration config unavailable");
    const baseMint = pool.poolState.baseMint;
    const dammPool = deriveDammV2PoolAddress(dammConfig, baseMint, NATIVE_MINT);
    const metadata = PublicKey.findProgramAddressSync([Buffer.from("damm_v2"), input.pool.toBuffer()], DYNAMIC_BONDING_CURVE_PROGRAM_ID)[0];
    const eventAuthority = PublicKey.findProgramAddressSync([Buffer.from("__event_authority")], DAMM_V2_PROGRAM_ID)[0];
    const tx = await this.dbc.program.methods.migrationDammV2().accountsStrict({
      virtualPool: input.pool, migrationMetadata: metadata, config: pool.poolState.config, poolAuthority: deriveDbcPoolAuthority(), pool: dammPool,
      firstPositionNftMint: input.firstPositionNftMint, firstPosition: derivePositionAddress(input.firstPositionNftMint), firstPositionNftAccount: derivePositionNftAccount(input.firstPositionNftMint),
      secondPositionNftMint: input.secondPositionNftMint, secondPosition: derivePositionAddress(input.secondPositionNftMint), secondPositionNftAccount: derivePositionNftAccount(input.secondPositionNftMint),
      dammPoolAuthority: derivePoolAuthority(), ammProgram: DAMM_V2_PROGRAM_ID, baseMint, quoteMint: NATIVE_MINT,
      tokenAVault: deriveTokenVaultAddress(baseMint, dammPool), tokenBVault: deriveTokenVaultAddress(NATIVE_MINT, dammPool),
      baseVault: pool.poolState.baseVault, quoteVault: pool.poolState.quoteVault, payer: input.payer,
      tokenBaseProgram: TOKEN_PROGRAM_ID, tokenQuoteProgram: TOKEN_PROGRAM_ID, token2022Program: TOKEN_2022_PROGRAM_ID,
      systemProgram: SystemProgram.programId, dammEventAuthority: eventAuthority,
    }).remainingAccounts([{ pubkey: dammConfig, isSigner: false, isWritable: false }]).transaction();
    tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }));
    return { ...await this.prepare(tx, input.payer), dammPool: dammPool.toBase58(),
      positions: [input.firstPositionNftMint, input.secondPositionNftMint].map((mint) => ({ nftMint: mint.toBase58(), position: derivePositionAddress(mint).toBase58(), nftAccount: derivePositionNftAccount(mint).toBase58() })) };
  }

  async prepareCreatorFeeClaim(input: { pool: PublicKey; creator: PublicKey; receiver: PublicKey; payer: PublicKey; maxQuoteAmount: bigint }) {
    const state = await this.readCurve(input.pool);
    if (!state.pool.poolState.creator.equals(input.creator) || state.config.collectFeeMode !== CollectFeeMode.QuoteToken) throw new Error("Creator fee authority or fee policy mismatch");
    const tx = await this.dbc.creator.claimCreatorTradingFeeToReceiver({ ...input, maxBaseAmount: new BN(0), maxQuoteAmount: amount(input.maxQuoteAmount) });
    return this.prepare(tx, input.payer);
  }

  async readDamm(pool: PublicKey): Promise<PoolState> {
    await this.guard();
    const state = await this.damm.fetchPoolState(pool);
    if (!state.tokenBMint.equals(NATIVE_MINT) || state.tokenAFlag !== 0 || state.tokenBFlag !== 0 || state.collectFeeMode !== EXPECTED_DAMM_COLLECT_FEE_MODE) throw new Error("DAMM must be classic SPL with SOL quote-only collection");
    const fee = getBaseFeeHandlerFromPodAlignedData(state.poolFees.baseFee.baseFeeInfo.data);
    if (!fee.getMinFeeNumerator().eq(new BN(5_000_000)) || !fee.getMaxFeeNumerator().eq(new BN(5_000_000)) || state.poolFees.dynamicFee.initialized !== 0 || state.poolFees.compoundingFeeBps !== 0) throw new Error("DAMM fee policy differs from launch");
    return state;
  }

  async readPosition(position: PublicKey) {
    await this.guard();
    return this.damm.fetchPositionState(position);
  }

  async verifyPosition(input: { pool: PublicKey; position: PublicKey; nftAccount: PublicKey; owner: PublicKey }) {
    await this.readDamm(input.pool);
    const state = await this.readPosition(input.position);
    const nft = await getAccount(this.connection, input.nftAccount, "finalized", TOKEN_2022_PROGRAM_ID);
    if (!state.pool.equals(input.pool) || !nft.mint.equals(state.nftMint) || nft.amount !== 1n || !nft.owner.equals(input.owner) ||
        !state.unlockedLiquidity.isZero() || !state.vestedLiquidity.isZero() || state.permanentLockedLiquidity.isZero()) throw new Error("Position owner or permanent lock verification failed");
    return { state, nft };
  }

  async preparePositionFeeClaim(input: { pool: PublicKey; position: PublicKey; nftAccount: PublicKey; owner: PublicKey; receiver: PublicKey; payer: PublicKey }) {
    const pool = await this.readDamm(input.pool);
    await this.verifyPosition(input);
    const tx = await this.damm.claimPositionFee2({ owner: input.owner, pool: input.pool, position: input.position, positionNftAccount: input.nftAccount,
      tokenAMint: pool.tokenAMint, tokenBMint: pool.tokenBMint, tokenAVault: pool.tokenAVault, tokenBVault: pool.tokenBVault,
      tokenAProgram: TOKEN_PROGRAM_ID, tokenBProgram: TOKEN_PROGRAM_ID, receiver: input.receiver, feePayer: input.payer });
    return this.prepare(tx, input.payer);
  }

  async quoteDammSwap(poolAddress: PublicKey, amountIn: bigint, swapBaseForQuote: boolean, slippageBps: number) {
    assertSlippage(slippageBps);
    const poolState = await this.readDamm(poolAddress);
    const currentPoint = await getCurrentPoint(this.connection, poolState.activationType);
    return { quote: this.damm.getQuote2({ poolState, inputTokenMint: swapBaseForQuote ? poolState.tokenAMint : NATIVE_MINT,
      slippage: slippageBps / 100, currentPoint, tokenADecimal: 6, tokenBDecimal: 9, hasReferral: false,
      swapMode: DammSwapMode.ExactIn, amountIn: amount(amountIn) }), expiresAt: Date.now() + 30_000 };
  }

  async prepareDammSwap(input: { pool: PublicKey; owner: PublicKey; amountIn: bigint; minimumAmountOut: bigint; swapBaseForQuote: boolean; expiresAt: number }) {
    if (input.expiresAt <= Date.now() || input.expiresAt > Date.now() + 60_000) throw new Error("Swap quote expired or invalid");
    const state = await this.readDamm(input.pool);
    const tx = await this.damm.swap2({ pool: input.pool, payer: input.owner, inputTokenMint: input.swapBaseForQuote ? state.tokenAMint : NATIVE_MINT,
      outputTokenMint: input.swapBaseForQuote ? NATIVE_MINT : state.tokenAMint, tokenAMint: state.tokenAMint, tokenBMint: state.tokenBMint,
      tokenAVault: state.tokenAVault, tokenBVault: state.tokenBVault, tokenAProgram: TOKEN_PROGRAM_ID, tokenBProgram: TOKEN_PROGRAM_ID,
      amountIn: amount(input.amountIn), minimumAmountOut: amount(input.minimumAmountOut), swapMode: DammSwapMode.ExactIn, referralTokenAccount: null, poolState: state });
    return this.prepare(tx, input.owner);
  }
}
