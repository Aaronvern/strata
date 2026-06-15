import { verifyProof } from '@reclaimprotocol/js-sdk';
import type { CredentialResult } from '../types.js';
import type { CredentialAdapter, CredentialProofInput } from './credential.js';
import { isReclaimProof } from './credential.js';
import { mapExtractedParams, type ReclaimProfile } from './reclaimProfiles.js';

const ZERO_ADDR = ('0x' + '00'.repeat(20)) as `0x${string}`;
const ZERO_HASH = ('0x' + '00'.repeat(32)) as `0x${string}`;
const BYTES32 = /^0x[a-fA-F0-9]{64}$/;
const ADDRESS = /^0x[a-fA-F0-9]{40}$/;

export interface ReclaimAdapterOptions {
  providerId: string;
  providerVersion: string;
  profile: ReclaimProfile;
  maxAgeSec: number;
  now?: () => number;
}

function invalid(): CredentialResult {
  return {
    valid: false,
    kycTier: 'none',
    jurisdictionCode: 'none',
    credentialEvidenceHash: ZERO_HASH,
    issuer: ZERO_ADDR,
    provider: 'reclaim'
  };
}

export function createReclaimCredentialAdapter(opts: ReclaimAdapterOptions): CredentialAdapter {
  const nowFn = opts.now ?? (() => Math.floor(Date.now() / 1000));

  return {
    provider: 'reclaim',
    async verify(proof: CredentialProofInput, wallet: `0x${string}`): Promise<CredentialResult> {
      if (!isReclaimProof(proof)) return invalid();

      const proofs = Array.isArray(proof.proofs) ? proof.proofs : [proof.proofs];
      if (proofs.length === 0) return invalid();

      let result: { isVerified?: boolean; data?: unknown[] };
      try {
        result = (await verifyProof(proofs as never, {
          providerId: opts.providerId,
          providerVersion: proof.providerVersion ?? opts.providerVersion
        } as never)) as { isVerified?: boolean; data?: unknown[] };
      } catch {
        return invalid();
      }

      if (!result?.isVerified || !Array.isArray(result.data) || result.data.length === 0) {
        return invalid();
      }

      const first = proofs[0] as {
        identifier?: string;
        claimData?: { timestampS?: number };
        witnesses?: Array<{ id?: string }>;
      };
      const datum = result.data[0] as {
        context?: { contextAddress?: string };
        extractedParameters?: Record<string, unknown>;
      };

      // 1) wallet binding (context.contextAddress is part of the signed claim)
      const ctxAddress = String(datum?.context?.contextAddress ?? '').toLowerCase();
      if (ctxAddress !== wallet.toLowerCase()) return invalid();

      // 2) freshness
      const ts = Number(first?.claimData?.timestampS ?? 0);
      if (!ts || nowFn() - ts > opts.maxAgeSec) return invalid();

      // 3) mapping (deny-by-default)
      const params = (datum?.extractedParameters ?? {}) as Record<string, unknown>;
      const mapped = mapExtractedParams(opts.profile, params);
      if (!mapped) return invalid();

      // 4) evidence hash = the proof's signed identifier (bytes32), shared with the client
      const identifier = String(first?.identifier ?? '');
      if (!BYTES32.test(identifier)) return invalid();

      // 5) issuer = the attestor/witness address that signed the claim
      const witnessId = String(first?.witnesses?.[0]?.id ?? '');
      const issuer = (ADDRESS.test(witnessId) ? witnessId : ZERO_ADDR) as `0x${string}`;

      return {
        valid: true,
        kycTier: mapped.kycTier,
        jurisdictionCode: mapped.jurisdictionCode,
        credentialEvidenceHash: identifier as `0x${string}`,
        issuer,
        provider: 'reclaim'
      };
    }
  };
}
