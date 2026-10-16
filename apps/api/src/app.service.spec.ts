import { Test, TestingModule } from '@nestjs/testing';
import { AppService } from './app.service';
import { PrismaService } from './prisma/prisma.service';
import { CacheService } from './cache/cache.service';

describe('AppService', () => {
  let service: AppService;
  let prisma: { $queryRaw: jest.Mock };
  let cache: { ping: jest.Mock };

  beforeEach(async () => {
    prisma = { $queryRaw: jest.fn() };
    cache = { ping: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AppService,
        { provide: PrismaService, useValue: prisma },
        { provide: CacheService, useValue: cache },
      ],
    }).compile();

    service = module.get<AppService>(AppService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getHealth', () => {
    it('returns ok when postgres and redis are both healthy', async () => {
      prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
      cache.ping.mockResolvedValue(true);

      await expect(service.getHealth()).resolves.toEqual({
        status: 'ok',
        checks: { postgres: true, redis: true },
      });
    });

    it('returns degraded with postgres false when $queryRaw rejects', async () => {
      prisma.$queryRaw.mockRejectedValue(new Error('connection refused'));
      cache.ping.mockResolvedValue(true);

      await expect(service.getHealth()).resolves.toEqual({
        status: 'degraded',
        checks: { postgres: false, redis: true },
      });
    });

    it('returns degraded with redis false when ping is falsy', async () => {
      prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
      cache.ping.mockResolvedValue(false);

      await expect(service.getHealth()).resolves.toEqual({
        status: 'degraded',
        checks: { postgres: true, redis: false },
      });
    });

    it('returns degraded with both false when postgres and redis fail', async () => {
      prisma.$queryRaw.mockRejectedValue(new Error('connection refused'));
      cache.ping.mockResolvedValue(false);

      await expect(service.getHealth()).resolves.toEqual({
        status: 'degraded',
        checks: { postgres: false, redis: false },
      });
    });
  });
});
