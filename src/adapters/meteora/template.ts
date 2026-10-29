import { PublicKey } from "@solana/web3.js";
import {
  ActivationType, BaseFeeMode, CollectFeeMode, DammV2DynamicFeeMode,
  MigratedCollectFeeMode, MigrationFeeOption, MigrationOption, TokenAuthorityOption,
  TokenDecimal, TokenType, buildCurve, validateConfigParameters,
  PROTOCOL_FEE_PERCENT, PROTOCOL_LIQUIDITY_MIGRATION_FEE_BPS,
  type BuildCurveParams, type ConfigParameters,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import { CollectFeeMode as DammCollectFeeMode } from "@meteora-ag/cp-amm-sdk";

export const TEMPLATE_VERSION = "devnet-spl-sol-1";
export const TOKEN_SUPPLY_RAW = 1_000_000_000_000_000n;
export const TOKEN_DECIMALS = 6;
export const CURVE_FEE_BPS = 50;
export const EXPECTED_DAMM_COLLECT_FEE_MODE = DammCollectFeeMode.OnlyB;

/** Fresh SDK input every time; callers cannot mutate a shared policy object. */
export function launchTemplateParameters(): BuildCurveParams {
  return {
    token: {
      tokenType: TokenType.SPLToken, tokenBaseDecimal: TokenDecimal.SIX,
      tokenQuoteDecimal: 9, tokenAuthorityOption: TokenAuthorityOption.Immutable,
      totalTokenSupply: 1_000_000_000, leftover: 0,
    },
    fee: {
      baseFeeParams: {
        baseFeeMode: BaseFeeMode.FeeSchedulerLinear,
        feeSchedulerParam: { startingFeeBps: 50, endingFeeBps: 50, numberOfPeriod: 0, totalDuration: 0 },
      },
      dynamicFeeEnabled: false, collectFeeMode: CollectFeeMode.QuoteToken,
      creatorTradingFeePercentage: 75, poolCreationFee: 0, enableFirstSwapWithMinFee: false,
    },
    migration: {
      migrationOption: MigrationOption.MET_DAMM_V2, migrationFeeOption: MigrationFeeOption.Customizable,
      migrationFee: { feePercentage: 0, creatorFeePercentage: 0 },
      migratedPoolFee: {
        collectFeeMode: MigratedCollectFeeMode.QuoteToken,
        dynamicFee: DammV2DynamicFeeMode.Disabled, poolFeeBps: 50, compoundingFeeBps: 0,
      },
    },
    liquidityDistribution: {
      partnerLiquidityPercentage: 0, partnerPermanentLockedLiquidityPercentage: 50,
      creatorLiquidityPercentage: 0, creatorPermanentLockedLiquidityPercentage: 50,
    },
    lockedVesting: {
      totalLockedVestingAmount: 0, numberOfVestingPeriod: 0, cliffUnlockAmount: 0,
      totalVestingDuration: 0, cliffDurationFromMigrationTime: 0,
    },
    activationType: ActivationType.Slot,
    percentageSupplyOnMigration: 25,
    migrationQuoteThreshold: 1,
  };
}

/** SDK math and validation are authoritative; no fallback to mock config. */
export function buildLaunchTemplate(leftoverReceiver: PublicKey): ConfigParameters {
  const config = buildCurve(launchTemplateParameters());
  validateConfigParameters({ ...config, leftoverReceiver }, { isTransferHook: false, transferFeeParameters: null });
  return config;
}

export function launchFeeDisclosure() {
  const protocolBps = CURVE_FEE_BPS * PROTOCOL_FEE_PERCENT / 100;
  return {
    templateVersion: TEMPLATE_VERSION,
    curveFeeBps: CURVE_FEE_BPS,
    protocolBps,
    creatorSideBps: (CURVE_FEE_BPS - protocolBps) * 75 / 100,
    partnerSideBps: (CURVE_FEE_BPS - protocolBps) * 25 / 100,
    protocolMigrationFeeBps: PROTOCOL_LIQUIDITY_MIGRATION_FEE_BPS,
    platformCreationFeeLamports: "0",
    platformMigrationFeePercentage: 0,
    migratedCreatorFee: "Actual finalized LP position fees, not a fixed share of volume",
  };
}
