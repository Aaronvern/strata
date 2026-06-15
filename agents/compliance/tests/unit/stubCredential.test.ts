import { describe, it, expect } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { keccak256, encodePacked } from 'viem';
import {
  createStubCredentialAdapter,
  signStubCredential,
  STUB_ISSUER_ADDRESS,
  STUB_ISSUER_PRIVATE_KEY
} from '../../src/adapters/stubCredential.js';

const walletA = privateKeyToAccount(
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
).address;
const walletB = privateKeyToAccount(
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a'
).address;

const NOW_SEC = 1_700_000_000;
const clock = () => NOW_SEC;

describe('stubCredential adapter', () => {
  it('accepts a valid credential signed by the stub issuer', async () => {
    const adapter = createStubCredentialAdapter({ now: clock });
    const proof = await signStubCredential(
      walletA,
      'basic',
      'US',
      NOW_SEC - 3600,
      NOW_SEC + 86400
    );

    const result = await adapter.verify(proof, walletA);

    expect(result.valid).toBe(true);
    expect(result.kycTier).toBe('basic');
    expect(result.jurisdictionCode).toBe('US');
    expect(result.provider).toBe('stub');
    expect(result.issuer.toLowerCase()).toBe(STUB_ISSUER_ADDRESS.toLowerCase());
  });

  it('rejects when proof wallet does not match verification wallet', async () => {
    const adapter = createStubCredentialAdapter({ now: clock });
    const proof = await signStubCredential(
      walletA,
      'enhanced',
      'GB',
      NOW_SEC - 3600,
      NOW_SEC + 86400
    );

    const result = await adapter.verify(proof, walletB);

    expect(result.valid).toBe(false);
  });

  it('rejects a credential signed by a different private key', async () => {
    const rogue = privateKeyToAccount(
      '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6'
    );

    const adapter = createStubCredentialAdapter({ now: clock });

    const signature = await rogue.signTypedData({
      domain: { name: 'StrataTestIssuer', version: '1', chainId: 5000 },
      types: {
        Credential: [
          { name: 'wallet', type: 'address' },
          { name: 'kycTier', type: 'string' },
          { name: 'jurisdictionCode', type: 'string' },
          { name: 'issuedAtSec', type: 'uint256' },
          { name: 'expiresAtSec', type: 'uint256' }
        ]
      },
      primaryType: 'Credential',
      message: {
        wallet: walletA,
        kycTier: 'basic',
        jurisdictionCode: 'US',
        issuedAtSec: BigInt(NOW_SEC - 3600),
        expiresAtSec: BigInt(NOW_SEC + 86400)
      }
    });

    const result = await adapter.verify(
      {
        issuer: rogue.address,
        wallet: walletA,
        kycTier: 'basic',
        jurisdictionCode: 'US',
        issuedAtSec: NOW_SEC - 3600,
        expiresAtSec: NOW_SEC + 86400,
        signature
      },
      walletA
    );

    expect(result.valid).toBe(false);
  });

  it('rejects an expired credential', async () => {
    const adapter = createStubCredentialAdapter({ now: clock });
    const proof = await signStubCredential(
      walletA,
      'basic',
      'US',
      NOW_SEC - 7200,
      NOW_SEC - 3600
    );

    const result = await adapter.verify(proof, walletA);

    expect(result.valid).toBe(false);
  });

  it('rejects a reclaim proof', async () => {
    const adapter = createStubCredentialAdapter({ now: clock });

    const result = await adapter.verify({ kind: 'reclaim', proofs: [] }, walletA);

    expect(result.valid).toBe(false);
    expect(result.provider).toBe('stub');
  });

  it('produces a deterministic credentialEvidenceHash for the same signature', async () => {
    const adapter = createStubCredentialAdapter({ now: clock });
    const proof = await signStubCredential(
      walletA,
      'basic',
      'US',
      NOW_SEC - 3600,
      NOW_SEC + 86400
    );

    const r1 = await adapter.verify(proof, walletA);
    const r2 = await adapter.verify(proof, walletA);

    expect(r1.credentialEvidenceHash).toBe(r2.credentialEvidenceHash);

    const expected = keccak256(encodePacked(['bytes'], [proof.signature]));
    expect(r1.credentialEvidenceHash).toBe(expected);
  });
});
