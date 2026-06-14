import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@reclaimprotocol/js-sdk', () => ({ verifyProof: vi.fn() }));
import { verifyProof } from '@reclaimprotocol/js-sdk';
import { createReclaimCredentialAdapter } from '../../src/adapters/reclaimCredential.js';
import { EXCHANGE_KYC_PROFILE } from '../../src/adapters/reclaimProfiles.js';

const WALLET = '0x2222222222222222222222222222222222222222' as `0x${string}`;
const NOW = 1_700_000_000;
const IDENTIFIER = ('0x' + 'ab'.repeat(32));
const WITNESS = ('0x' + 'cd'.repeat(20));

function fixtureProof(overrides: Record<string, unknown> = {}) {
  return {
    identifier: IDENTIFIER,
    claimData: { provider: 'http', timestampS: NOW - 10, context: '{}' },
    signatures: ['0xsig'],
    witnesses: [{ id: WITNESS, url: 'reclaim' }],
    ...overrides
  };
}

function adapter() {
  return createReclaimCredentialAdapter({
    providerId: 'prov-1',
    providerVersion: '1.0.0',
    profile: EXCHANGE_KYC_PROFILE,
    maxAgeSec: 900,
    now: () => NOW
  });
}

beforeEach(() => vi.resetAllMocks());

describe('reclaim credential adapter', () => {
  it('valid verified proof -> basic + permissionless, evidence hash = identifier', async () => {
    vi.mocked(verifyProof).mockResolvedValue({
      isVerified: true,
      data: [{ context: { contextAddress: WALLET }, extractedParameters: { kycStatus: 'verified' } }]
    } as never);
    const r = await adapter().verify({ kind: 'reclaim', proofs: [fixtureProof()] }, WALLET);
    expect(r.valid).toBe(true);
    expect(r.kycTier).toBe('basic');
    expect(r.jurisdictionCode).toBe('permissionless');
    expect(r.credentialEvidenceHash).toBe(IDENTIFIER);
    expect(r.issuer.toLowerCase()).toBe(WITNESS);
    expect(r.provider).toBe('reclaim');
  });

  it('isVerified false -> invalid', async () => {
    vi.mocked(verifyProof).mockResolvedValue({ isVerified: false, data: [] } as never);
    const r = await adapter().verify({ kind: 'reclaim', proofs: [fixtureProof()] }, WALLET);
    expect(r.valid).toBe(false);
  });

  it('context address mismatch -> invalid', async () => {
    vi.mocked(verifyProof).mockResolvedValue({
      isVerified: true,
      data: [{ context: { contextAddress: '0x9999999999999999999999999999999999999999' }, extractedParameters: { kycStatus: 'verified' } }]
    } as never);
    const r = await adapter().verify({ kind: 'reclaim', proofs: [fixtureProof()] }, WALLET);
    expect(r.valid).toBe(false);
  });

  it('stale proof -> invalid', async () => {
    vi.mocked(verifyProof).mockResolvedValue({
      isVerified: true,
      data: [{ context: { contextAddress: WALLET }, extractedParameters: { kycStatus: 'verified' } }]
    } as never);
    const stale = fixtureProof({ claimData: { provider: 'http', timestampS: NOW - 10_000, context: '{}' } });
    const r = await adapter().verify({ kind: 'reclaim', proofs: [stale] }, WALLET);
    expect(r.valid).toBe(false);
  });

  it('unmappable status -> invalid', async () => {
    vi.mocked(verifyProof).mockResolvedValue({
      isVerified: true,
      data: [{ context: { contextAddress: WALLET }, extractedParameters: { kycStatus: 'pending' } }]
    } as never);
    const r = await adapter().verify({ kind: 'reclaim', proofs: [fixtureProof()] }, WALLET);
    expect(r.valid).toBe(false);
  });

  it('non-reclaim input -> invalid', async () => {
    const r = await adapter().verify({
      issuer: '0x1111111111111111111111111111111111111111',
      wallet: WALLET, kycTier: 'basic', jurisdictionCode: 'US',
      issuedAtSec: 1, expiresAtSec: 2, signature: '0xabcd'
    }, WALLET);
    expect(r.valid).toBe(false);
  });

  it('empty proofs array -> invalid (verifyProof not called)', async () => {
    const r = await adapter().verify({ kind: 'reclaim', proofs: [] }, WALLET);
    expect(r.valid).toBe(false);
    expect(vi.mocked(verifyProof)).not.toHaveBeenCalled();
  });

  it('verifyProof throws -> invalid', async () => {
    vi.mocked(verifyProof).mockRejectedValue(new Error('network down'));
    const r = await adapter().verify({ kind: 'reclaim', proofs: [fixtureProof()] }, WALLET);
    expect(r.valid).toBe(false);
  });

  it('non-bytes32 identifier -> invalid', async () => {
    vi.mocked(verifyProof).mockResolvedValue({
      isVerified: true,
      data: [{ context: { contextAddress: WALLET }, extractedParameters: { kycStatus: 'verified' } }]
    } as never);
    const r = await adapter().verify({ kind: 'reclaim', proofs: [fixtureProof({ identifier: '0x1234' })] }, WALLET);
    expect(r.valid).toBe(false);
  });

  it('valid proof with no witnesses -> valid with zero issuer', async () => {
    vi.mocked(verifyProof).mockResolvedValue({
      isVerified: true,
      data: [{ context: { contextAddress: WALLET }, extractedParameters: { kycStatus: 'verified' } }]
    } as never);
    const r = await adapter().verify({ kind: 'reclaim', proofs: [fixtureProof({ witnesses: [] })] }, WALLET);
    expect(r.valid).toBe(true);
    expect(r.issuer).toBe('0x' + '00'.repeat(20));
  });
});
