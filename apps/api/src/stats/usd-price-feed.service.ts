import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CacheService, TTL } from '../cache/cache.service';

const COINGECKO_API_URL =
  process.env.COINGECKO_API_URL ?? 'https://api.coingecko.com/api/v3';

/** Cache key written for each token's USD price; read by StatsWorker.getUsdPrice(). */
export const USD_PRICE_CACHE_KEY = (token: string) => `price:usd:${token}`;

/**
 * Relative tolerance within which the USD price used for TVL and the price
 * used for volume are considered to agree. Beyond this, a single stats
 * computation is internally inconsistent and must be rejected.
 */
export const USD_PRICE_CONSISTENCY_TOLERANCE = 0.01;

/**
 * Thrown when the USD price used for TVL differs from the price used for
 * volume beyond USD_PRICE_CONSISTENCY_TOLERANCE within one stats computation.
 */
export class UsdPriceConsistencyError extends Error {
  constructor(
    readonly token: string,
    readonly tvlPrice: number,
    readonly volumePrice: number,
    readonly tolerance: number = USD_PRICE_CONSISTENCY_TOLERANCE,
  ) {
    super(
      `USD price inconsistency for ${token}: TVL price ${tvlPrice} vs volume price ${volumePrice} exceeds tolerance ${tolerance}`,
    );
    this.name = 'UsdPriceConsistencyError';
  }
}

/**
 * Refreshes `price:usd:*` from CoinGecko so pool TVL/volume/fee-APR are
 * priced off a real feed instead of StatsWorker's getUsdPrice() default of 1.
 *
 * Token → CoinGecko id mapping comes from COINGECKO_TOKEN_ID_MAP, a JSON
 * object of `{ "<token address>": "<coingecko id>" }`. Tokens absent from the
 * map are skipped — their cached price stays whatever was last written (or
 * the getUsdPrice() default of 1 if never written).
 */
@Injectable()
export class UsdPriceFeedService {
  private readonly logger = new Logger(UsdPriceFeedService.name);
  private readonly tokenIdMap: Record<string, string>;

  constructor(private readonly cache: CacheService) {
    this.tokenIdMap = this.parseTokenIdMap(process.env.COINGECKO_TOKEN_ID_MAP);
  }

  private parseTokenIdMap(raw: string | undefined): Record<string, string> {
    if (!raw) return {};
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, string>;
      }
    } catch (err) {
      this.logger.error(
        `Invalid COINGECKO_TOKEN_ID_MAP — must be a JSON object: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return {};
  }

  /**
   * Single shared accessor for the USD price of a token within a stats
   * computation. Both pool TVL and volume metrics must read prices through
   * this method so a single computation uses one consistent price value.
   */
  async getUsdPrice(token: string): Promise<number> {
    const cached = await this.cache.get<number>(USD_PRICE_CACHE_KEY(token));
    if (typeof cached === 'number' && Number.isFinite(cached) && cached > 0) {
      return cached;
    }
    return 1;
  }

  /**
   * Asserts that the USD price used for TVL and the price used for volume
   * agree within USD_PRICE_CONSISTENCY_TOLERANCE. Throws a typed
   * UsdPriceConsistencyError when they diverge, so a stats computation
   * cannot silently report internally inconsistent numbers.
   */
  assertConsistentPrice(
    token: string,
    tvlPrice: number,
    volumePrice: number,
    tolerance: number = USD_PRICE_CONSISTENCY_TOLERANCE,
  ): void {
    if (
      !Number.isFinite(tvlPrice) ||
      !Number.isFinite(volumePrice) ||
      tvlPrice <= 0 ||
      volumePrice <= 0
    ) {
      throw new UsdPriceConsistencyError(token, tvlPrice, volumePrice, tolerance);
    }
    const relativeDiff = Math.abs(tvlPrice - volumePrice) / tvlPrice;
    if (relativeDiff > tolerance) {
      throw new UsdPriceConsistencyError(token, tvlPrice, volumePrice, tolerance);
    }
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async refreshPrices(): Promise<void> {
    const entries = Object.entries(this.tokenIdMap);
    if (entries.length === 0) {
      this.logger.debug(
        'COINGECKO_TOKEN_ID_MAP not configured — skipping USD price refresh',
      );
      return;
    }

    const ids = [...new Set(entries.map(([, id]) => id))].join(',');
    let prices: Record<string, { usd?: number }>;
    try {
      const res = await fetch(
        `${COINGECKO_API_URL}/simple/price?ids=${encodeURIComponent(ids)}&vs_currencies=usd`,
      );
      if (!res.ok) {
        throw new Error(`CoinGecko responded ${res.status}`);
      }
      prices = (await res.json()) as Record<string, { usd?: number }>;
    } catch (err) {
      this.logger.error(
        `Failed to fetch USD prices from CoinGecko: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }

    let written = 0;
    for (const [tokenAddress, coingeckoId] of entries) {
      const usd = prices[coingeckoId]?.usd;
      if (typeof usd !== 'number' || !Number.isFinite(usd) || usd < 0) {
        continue;
      }
      await this.cache.set(
        USD_PRICE_CACHE_KEY(tokenAddress),
        usd,
        TTL.USD_PRICE,
      );
      written++;
    }
    this.logger.log(
      `Refreshed USD prices for ${written}/${entries.length} tokens`,
    );
  }
}
