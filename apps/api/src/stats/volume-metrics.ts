export interface SwapAmounts {
  amount0: string;
  amount1: string;
}

/**
 * Maximum relative difference tolerated between the USD price used for TVL
 * and the USD price used for volume within a single stats computation.
 */
export const USD_PRICE_CONSISTENCY_TOLERANCE = 0.01;

/**
 * Typed error thrown when the USD price used for TVL and the USD price used
 * for volume diverge beyond {@link USD_PRICE_CONSISTENCY_TOLERANCE}.
 */
export class UsdPriceConsistencyError extends Error {
  readonly code = 'USD_PRICE_INCONSISTENT';

  constructor(
    readonly priceTvl: number,
    readonly priceVolume: number,
    readonly tolerance: number = USD_PRICE_CONSISTENCY_TOLERANCE,
  ) {
    super(
      `USD price used for TVL (${priceTvl}) differs from the price used for volume (${priceVolume}) beyond tolerance ${tolerance}`,
    );
    this.name = 'UsdPriceConsistencyError';
  }
}

/**
 * Asserts that the USD price used for TVL and the USD price used for volume
 * within a single stats computation agree within the documented tolerance.
 * Throws a typed {@link UsdPriceConsistencyError} otherwise.
 */
export function assertUsdPriceConsistency(
  priceTvl: number,
  priceVolume: number,
  tolerance: number = USD_PRICE_CONSISTENCY_TOLERANCE,
): void {
  if (!Number.isFinite(priceTvl) || !Number.isFinite(priceVolume)) {
    throw new UsdPriceConsistencyError(priceTvl, priceVolume, tolerance);
  }
  const reference = Math.max(Math.abs(priceTvl), Math.abs(priceVolume));
  if (reference === 0) return;
  const relativeDiff = Math.abs(priceTvl - priceVolume) / reference;
  if (relativeDiff > tolerance) {
    throw new UsdPriceConsistencyError(priceTvl, priceVolume, tolerance);
  }
}

export function isInHalfOpenWindow(
  timestamp: Date,
  start: Date,
  end: Date,
): boolean {
  const time = timestamp.getTime();
  return (
    Number.isFinite(time) && time >= start.getTime() && time < end.getTime()
  );
}

function usdAmount(
  rawAmount: string,
  decimals: number,
  priceUsd: number,
): number {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    throw new Error('Token decimals are invalid');
  }
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
    throw new Error('Token USD price is invalid');
  }
  if (!/^-?\d+$/.test(rawAmount)) {
    throw new Error('Swap amount is invalid');
  }

  const raw = BigInt(rawAmount);
  const amount = Number(raw < 0n ? -raw : raw) / 10 ** decimals;
  const value = amount * priceUsd;
  if (!Number.isFinite(value)) throw new Error('Swap USD amount is invalid');
  return value;
}

export function calculateSwapVolumeUsd(
  swap: SwapAmounts,
  decimals0: number,
  decimals1: number,
  price0: number,
  price1: number,
): number {
  return (
    usdAmount(swap.amount0, decimals0, price0) +
    usdAmount(swap.amount1, decimals1, price1)
  );
}

export function calculateSwapFeesUsd(
  feeAmount0: string,
  decimals0: number,
  price0: number,
): number {
  return usdAmount(feeAmount0, decimals0, price0);
}
