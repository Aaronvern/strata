import { describe, it, expect } from 'vitest';
import { isReclaimProof } from '../../src/adapters/credential.js';
import { CredentialProvider } from '../../src/types.js';

describe('credential input union', () => {
  it('CredentialProvider accepts reclaim', () => {
    expect(CredentialProvider.parse('reclaim')).toBe('reclaim');
  });

  it('isReclaimProof is true for a reclaim proof', () => {
    expect(isReclaimProof({ kind: 'reclaim', proofs: [] })).toBe(true);
  });

  it('isReclaimProof is false for a stub EIP-712 credential', () => {
    const stub = {
      issuer: '0x1111111111111111111111111111111111111111',
      wallet: '0x2222222222222222222222222222222222222222',
      kycTier: 'basic' as const,
      jurisdictionCode: 'US',
      issuedAtSec: 1,
      expiresAtSec: 2,
      signature: '0xabcd'
    };
    expect(isReclaimProof(stub)).toBe(false);
  });
});
