import { ForbiddenException } from '@nestjs/common';
import { SmekCommandStructuralError } from '../kernel/smek-kernel.errors';
import {
  assertFindOptionsIncludesTenantId,
  assertSmekTransitionTenantMatchesOptionalAls,
} from './tenant-isolation.policy';

describe('tenant-isolation.policy', () => {
  describe('assertSmekTransitionTenantMatchesOptionalAls', () => {
    it('allows when no active tenant context', () => {
      expect(() =>
        assertSmekTransitionTenantMatchesOptionalAls(undefined, 'tenant-a'),
      ).not.toThrow();
    });

    it('allows when active tenant matches transition tenant', () => {
      expect(() => assertSmekTransitionTenantMatchesOptionalAls('tenant-a', 'tenant-a')).not.toThrow();
    });

    it('FAILs cross-tenant access when ALS tenant is set', () => {
      expect(() => assertSmekTransitionTenantMatchesOptionalAls('tenant-a', 'tenant-b')).toThrow(
        SmekCommandStructuralError,
      );
    });
  });

  describe('assertFindOptionsIncludesTenantId', () => {
    it('accepts where with tenantId', () => {
      expect(() => assertFindOptionsIncludesTenantId({ tenantId: 't1' })).not.toThrow();
    });

    it('FAILs when tenantId missing', () => {
      expect(() => assertFindOptionsIncludesTenantId({ correlationId: 'x' })).toThrow(ForbiddenException);
    });
  });
});
