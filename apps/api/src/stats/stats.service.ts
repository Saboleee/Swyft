import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface GlobalStats {
  totalTvl: string;
  totalVolume24h: string;
  poolCount: number;
  activePositions: number;
  totalSwaps: number;
}

/**
 * Maximum relative divergence tolerated between the USD price used for TVL
 * and the USD price used for volume within a single stats computation.
 * Beyond this the two figures are considered internally inconsistent.
 */
export const USD_PRICE_CONSISTENCY_TOLERANCE = 0.01;

/**
 * Thrown when the USD price backing TVL and the USD price backing volume
 * disagree beyond {@link USD_PRICE_CONSISTENCY_TOLERANCE} for a single
 * stats computation.
 */
export class InconsistentUsdPriceError extends Error {
  constructor(
    readonly tvlPrice: number,
    readonly volumePrice: number,
    readonly tolerance: number = USD_PRICE_CONSISTENCY_TOLERANCE,
  ) {
    super(
      `Inconsistent USD prices: TVL price ${tvlPrice} differs from volume price ${volumePrice} beyond tolerance ${tolerance}`,
    );
    this.name = 'InconsistentUsdPriceError';
  }
}

/**
 * Asserts that the USD price used for TVL and the USD price used for volume
 * agree within the documented tolerance. Throws a typed error otherwise so
 * callers never emit internally inconsistent stats.
 */
export function assertConsistentUsdPrice(
  tvlPrice: number,
  volumePrice: number,
  tolerance: number = USD_PRICE_CONSISTENCY_TOLERANCE,
): void {
  if (!Number.isFinite(tvlPrice) || !Number.isFinite(volumePrice)) {
    throw new InconsistentUsdPriceError(tvlPrice, volumePrice, tolerance);
  }

  const reference = Math.max(Math.abs(tvlPrice), Math.abs(volumePrice));
  const divergence =
    reference === 0
      ? 0
      : Math.abs(tvlPrice - volumePrice) / reference;

  if (divergence > tolerance) {
    throw new InconsistentUsdPriceError(tvlPrice, volumePrice, tolerance);
  }
}

@Injectable()
export class StatsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Aggregates platform-wide stats across all pools. */
  async computeGlobalStats(): Promise<GlobalStats> {
    const [pools, activePositions, totalSwaps] = await Promise.all([
      this.prisma.pool.findMany({ select: { tvl: true, volume24h: true } }),
      this.prisma.position.count({ where: { closedAt: null } }),
      this.prisma.swap.count(),
    ]);

    const totalTvl = pools.reduce((sum, p) => sum + Number(p.tvl), 0);
    const totalVolume24h = pools.reduce(
      (sum, p) => sum + Number(p.volume24h),
      0,
    );

    return {
      totalTvl: String(totalTvl),
      totalVolume24h: String(totalVolume24h),
      poolCount: pools.length,
      activePositions,
      totalSwaps,
    };
  }
}
