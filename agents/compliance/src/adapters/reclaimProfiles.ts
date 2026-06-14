import type { KycTier } from '../types.js';

export interface ReclaimProfile {
  name: string;
  /** key in extractedParameters holding KYC status */
  statusField: string;
  /** maps a status value to a tier */
  statusToTier: Record<string, KycTier>;
  /** optional: key holding the country/nationality */
  countryField?: string;
  /** optional: maps a country value to a Strata jurisdiction code */
  countryToJurisdiction?: Record<string, string>;
  /** applied only where a value cannot be derived from the proof */
  declaredDefaults?: { kycTier?: KycTier; jurisdictionCode?: string };
}

export const EXCHANGE_KYC_PROFILE: ReclaimProfile = {
  name: 'exchange-kyc',
  statusField: 'kycStatus',
  statusToTier: { verified: 'basic', advanced: 'enhanced', enhanced: 'enhanced' },
  declaredDefaults: { jurisdictionCode: 'permissionless' }
};

export const DEMO_PROFILE: ReclaimProfile = {
  name: 'demo',
  statusField: '__unused__',
  statusToTier: {},
  declaredDefaults: { kycTier: 'basic', jurisdictionCode: 'permissionless' }
};

const PROFILES: Record<string, ReclaimProfile> = {
  'exchange-kyc': EXCHANGE_KYC_PROFILE,
  demo: DEMO_PROFILE
};

export function getProfile(name: string): ReclaimProfile {
  const p = PROFILES[name];
  if (!p) throw new Error(`unknown reclaim profile: ${name}`);
  return p;
}

export interface MappedCredential {
  kycTier: KycTier;
  jurisdictionCode: string;
}

/** Deny-by-default: returns null when a required value cannot be derived. */
export function mapExtractedParams(
  profile: ReclaimProfile,
  params: Record<string, unknown>
): MappedCredential | null {
  let kycTier: KycTier | undefined;
  const rawStatus = params[profile.statusField];
  if (typeof rawStatus === 'string' && profile.statusToTier[rawStatus]) {
    kycTier = profile.statusToTier[rawStatus];
  } else if (profile.declaredDefaults?.kycTier) {
    kycTier = profile.declaredDefaults.kycTier;
  }
  if (!kycTier) return null;

  let jurisdictionCode: string | undefined;
  if (profile.countryField && profile.countryToJurisdiction) {
    const rawCountry = params[profile.countryField];
    if (typeof rawCountry === 'string') {
      jurisdictionCode = profile.countryToJurisdiction[rawCountry];
      if (!jurisdictionCode) return null; // country present but unmapped -> deny
    }
  }
  if (!jurisdictionCode && profile.declaredDefaults?.jurisdictionCode) {
    jurisdictionCode = profile.declaredDefaults.jurisdictionCode;
  }
  if (!jurisdictionCode) return null;

  return { kycTier, jurisdictionCode };
}
