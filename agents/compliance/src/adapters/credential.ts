import type { CredentialResult, CredentialProvider } from '../types.js';

/** EIP-712 stub credential (kept name `CredentialProof` for back-compat). */
export interface CredentialProof {
  issuer: `0x${string}`;
  wallet: `0x${string}`;
  kycTier: 'none' | 'basic' | 'enhanced';
  jurisdictionCode: string;
  issuedAtSec: number;
  expiresAtSec: number;
  signature: `0x${string}`;
  kind?: 'stub';
}

/** Reclaim Protocol proof input. `proofs` is verified inside the adapter. */
export interface ReclaimCredentialProof {
  kind: 'reclaim';
  proofs: unknown;
  providerVersion?: string;
}

export type CredentialProofInput = CredentialProof | ReclaimCredentialProof;

export function isReclaimProof(p: CredentialProofInput): p is ReclaimCredentialProof {
  return (p as { kind?: string }).kind === 'reclaim';
}

export interface CredentialAdapter {
  verify(proof: CredentialProofInput, wallet: `0x${string}`): Promise<CredentialResult>;
  readonly provider: CredentialProvider;
}
