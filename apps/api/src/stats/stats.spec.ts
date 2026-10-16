import { Test } from '@nestjs/testing';
import { StatsService } from './stats.service';
import { UsdPriceFeedService } from './usd-price-feed.service';
import { PoolPriceConsistencyError } from './pool-tvl';

describe('StatsService', () => {
  let service: StatsService;
  let priceFeed: UsdPriceFeedService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [StatsService, UsdPriceFeedService],
    }).compile();

    service = moduleRef.get(StatsService);
    priceFeed = moduleRef.get(UsdPriceFeedService);
  });

  it('computes TVL and volume from a single shared USD price accessor', () => {
    const pool = 'pool-1';
    priceFeed.setUsdPrice(pool, 2);

    const stats = service.getPoolStats(pool, {
      reserve0: 100,
      reserve1: 50,
      volume0: 10,
      volume1: 5,
    });

    expect(stats.tvlUsd).toBe(300);
    expect(stats.volumeUsd).toBe(30);
  });

  it('throws a typed error when TVL and volume prices diverge beyond tolerance', () => {
    const pool = 'pool-1';
    priceFeed.setUsdPrice(pool, 2);

    expect(() =>
      service.getPoolStats(pool, {
        reserve0: 100,
        reserve1: 50,
        volume0: 10,
        volume1: 5,
        volumePrice: 3,
      }),
    ).toThrow(PoolPriceConsistencyError);
  });
});
