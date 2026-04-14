import { ConfigService } from '@nestjs/config';
import { TenantCorrelationResolverService } from './tenant-correlation-resolver.service';

function makeConfig(mapJson?: string): ConfigService {
  return {
    get: (k: string) => (k === 'TWILIO_ACCOUNT_SID_TO_TENANT_JSON' ? mapJson : undefined),
  } as unknown as ConfigService;
}

describe('TenantCorrelationResolverService', () => {
  it('returns null when distinct tenant count is not exactly 1', async () => {
    const getRawOne = jest.fn().mockResolvedValue({ cnt: '2', tenantId: 't1' });
    const qb = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawOne,
    };
    const repo = { createQueryBuilder: jest.fn().mockReturnValue(qb) } as never;
    const svc = new TenantCorrelationResolverService(repo, makeConfig());
    await expect(svc.resolveTenantIdForCorrelation('corr-1')).resolves.toBeNull();
  });

  it('returns tenant when count is 1', async () => {
    const getRawOne = jest.fn().mockResolvedValue({ cnt: '1', tenantId: 'tenant-a' });
    const qb = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawOne,
    };
    const repo = { createQueryBuilder: jest.fn().mockReturnValue(qb) } as never;
    const svc = new TenantCorrelationResolverService(repo, makeConfig());
    await expect(svc.resolveTenantIdForCorrelation('corr-1')).resolves.toBe('tenant-a');
  });

  it('adds tenant_id predicate when AccountSid maps via config', async () => {
    const getRawOne = jest.fn().mockResolvedValue({ cnt: '1', tenantId: 'acme' });
    const andWhere = jest.fn().mockReturnThis();
    const qb = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere,
      getRawOne,
    };
    const repo = { createQueryBuilder: jest.fn().mockReturnValue(qb) } as never;
    const map = JSON.stringify({ AC123: 'acme' });
    const svc = new TenantCorrelationResolverService(repo, makeConfig(map));
    await svc.resolveTenantIdForCorrelation('corr-1', { twilioAccountSid: 'AC123' });
    expect(andWhere).toHaveBeenCalledWith('t.tenantId = :narrowTenant', { narrowTenant: 'acme' });
  });
});
