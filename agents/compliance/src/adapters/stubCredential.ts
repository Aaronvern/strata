import {
  privateKeyToAccount,
  type PrivateKeyAccount
} from 'viem/accounts';
import { verifyTypedData, keccak256, encodePacked } from 'viem';
import type { CredentialResult } from '../types.js';
import type { CredentialAdapter, CredentialProof, CredentialProofInput } from './credential.js';
import { isReclaimProof } from './credential.js';

export const STUB_ISSUER_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;

const stubAccount: PrivateKeyAccount = privateKeyToAccount(STUB_ISSUER_PRIVATE_KEY);
export const STUB_ISSUER_ADDRESS: `0x${string}` = stubAccount.address;

const DOMAIN = {
  name: 'StrataTestIssuer',
  version: '1',
  chainId: 5000
} as const;

const TYPES = {
  Credential: [
    { name: 'wallet', type: 'address' },
    { name: 'kycTier', type: 'string' },
    { name: 'jurisdictionCode', type: 'string' },
    { name: 'issuedAtSec', type: 'uint256' },
    { name: 'expiresAtSec', type: 'uint256' }
  ]
} as const;

function buildMessage(
  wallet: `0x${string}`,
  kycTier: string,
  jurisdictionCode: string,
  issuedAtSec: number,
  expiresAtSec: number
) {
  return {
    wallet,
    kycTier,
    jurisdictionCode,
    issuedAtSec: BigInt(issuedAtSec),
    expiresAtSec: BigInt(expiresAtSec)
  };
}

function invalidResult(proof: CredentialProof): CredentialResult {
  return {
    valid: false,
    kycTier: proof.kycTier,
    jurisdictionCode: proof.jurisdictionCode,
    credentialEvidenceHash: keccak256(encodePacked(['bytes'], [proof.signature])),
    issuer: proof.issuer,
    provider: 'stub'
  };
}

export async function signStubCredential(
  wallet: `0x${string}`,
  kycTier: 'none' | 'basic' | 'enhanced',
  jurisdictionCode: string,
  issuedAtSec: number,
  expiresAtSec: number
): Promise<CredentialProof> {
  const signature = await stubAccount.signTypedData({
    domain: DOMAIN,
    types: TYPES,
    primaryType: 'Credential',
    message: buildMessage(wallet, kycTier, jurisdictionCode, issuedAtSec, expiresAtSec)
  });

  return {
    issuer: STUB_ISSUER_ADDRESS,
    wallet,
    kycTier,
    jurisdictionCode,
    issuedAtSec,
    expiresAtSec,
    signature
  };
}

export function createStubCredentialAdapter(
  opts?: { now?: () => number }
): CredentialAdapter {
  const nowFn = opts?.now ?? (() => Math.floor(Date.now() / 1000));

  return {
    provider: 'stub' as const,

    async verify(proof: CredentialProofInput, wallet: `0x${string}`): Promise<CredentialResult> {
      if (isReclaimProof(proof)) {
        return {
          valid: false,
          kycTier: 'none',
          jurisdictionCode: 'none',
          credentialEvidenceHash: ('0x' + '00'.repeat(32)) as `0x${string}`,
          issuer: ('0x' + '00'.repeat(20)) as `0x${string}`,
          provider: 'stub'
        };
      }
      if (proof.wallet.toLowerCase() !== wallet.toLowerCase()) {
        return invalidResult(proof);
      }

      if (proof.expiresAtSec <= nowFn()) {
        return invalidResult(proof);
      }

      const message = buildMessage(
        proof.wallet,
        proof.kycTier,
        proof.jurisdictionCode,
        proof.issuedAtSec,
        proof.expiresAtSec
      );

      const sigValid = await verifyTypedData({
        address: proof.issuer,
        domain: DOMAIN,
        types: TYPES,
        primaryType: 'Credential',
        message,
        signature: proof.signature
      });

      if (!sigValid) {
        return invalidResult(proof);
      }

      if (proof.issuer.toLowerCase() !== STUB_ISSUER_ADDRESS.toLowerCase()) {
        return invalidResult(proof);
      }

      const evidenceHash = keccak256(encodePacked(['bytes'], [proof.signature]));

      return {
        valid: true,
        kycTier: proof.kycTier,
        jurisdictionCode: proof.jurisdictionCode,
        credentialEvidenceHash: evidenceHash,
        issuer: proof.issuer,
        provider: 'stub'
      };
    }
  };
}
