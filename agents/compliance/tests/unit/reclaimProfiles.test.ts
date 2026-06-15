import { describe, it, expect } from 'vitest';
import {
  getProfile,
  mapExtractedParams,
  EXCHANGE_KYC_PROFILE,
  DEMO_PROFILE,
  type ReclaimProfile
} from '../../src/adapters/reclaimProfiles.js';

describe('reclaim profiles', () => {
  it('getProfile returns known profiles and throws on unknown', () => {
    expect(getProfile('exchange-kyc').name).toBe('exchange-kyc');
    expect(getProfile('demo').name).toBe('demo');
    expect(() => getProfile('nope')).toThrow();
  });

  it('exchange profile: verified -> basic + permissionless default', () => {
    const r = mapExtractedParams(EXCHANGE_KYC_PROFILE, { kycStatus: 'verified' });
    expect(r).toEqual({ kycTier: 'basic', jurisdictionCode: 'permissionless' });
  });

  it('exchange profile: advanced -> enhanced', () => {
    const r = mapExtractedParams(EXCHANGE_KYC_PROFILE, { kycStatus: 'advanced' });
    expect(r?.kycTier).toBe('enhanced');
  });

  it('exchange profile: unknown status, no tier default -> deny (null)', () => {
    expect(mapExtractedParams(EXCHANGE_KYC_PROFILE, { kycStatus: 'pending' })).toBeNull();
  });

  it('demo profile: empty params -> basic + permissionless via defaults', () => {
    expect(mapExtractedParams(DEMO_PROFILE, {})).toEqual({
      kycTier: 'basic',
      jurisdictionCode: 'permissionless'
    });
  });

  it('country mapping resolves jurisdiction when configured', () => {
    const p: ReclaimProfile = {
      name: 'test',
      statusField: 'kycStatus',
      statusToTier: { verified: 'basic' },
      countryField: 'country',
      countryToJurisdiction: { GB: 'GB', DE: 'EU' }
    };
    expect(mapExtractedParams(p, { kycStatus: 'verified', country: 'DE' })).toEqual({
      kycTier: 'basic',
      jurisdictionCode: 'EU'
    });
    // country present but unmapped, no default -> deny
    expect(mapExtractedParams(p, { kycStatus: 'verified', country: 'ZZ' })).toBeNull();
  });
});
