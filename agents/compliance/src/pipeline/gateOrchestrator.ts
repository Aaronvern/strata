import type { CredentialAdapter, CredentialProofInput } from '../adapters/credential.js';
import type { SanctionsOracle } from '../adapters/sanctions.js';
import type { PolicyResolver } from './policyResolver.js';
import { routeTranches } from './trancheRouter.js';
import { buildReceipt } from './buildReceipt.js';
import { generateEvidenceKey, encryptEvidence, serializeBlob } from './evidence.js';
import { verifyDepositorAuth } from '../signing/eip712.js';
import type { GateResult } from '../types.js';

export interface GateOrchestratorDeps {
  credentialAdapter: CredentialAdapter;
  sanctionsOracle: SanctionsOracle;
  policyResolver: PolicyResolver;
  publisher: { publishReceipt: (draft: any) => Promise<{ receiptCid: string; receipt: any; txHash?: `0x${string}` }> };
  pinEvidence: (data: string, apiKey: string) => Promise<string>;
  lighthouseApiKey: string;
  publisherAddress: string;
  identityNFT: string;
  methodologyHash: string;
  codeCommit: string;
  readActiveReceipt?: (wallet: `0x${string}`) => Promise<{ receiptId: bigint; mask: number; kycExp: bigint; sanctionsExp: bigint } | null>;
  nowSec?: () => number;
}

export class GateOrchestrator {
  constructor(private deps: GateOrchestratorDeps) {}

  async runGateCycle(
    wallet: `0x${string}`,
    credentialProof: CredentialProofInput,
    depositorAuthSignature: `0x${string}`,
    deadline: number
  ): Promise<GateResult> {
    const nowSec = this.deps.nowSec?.() ?? Math.floor(Date.now() / 1000);

    if (this.deps.readActiveReceipt) {
      try {
        const existing = await this.deps.readActiveReceipt(wallet);
        if (existing && existing.receiptId > 0n) {
          const kycValid = Number(existing.kycExp) > nowSec;
          const sanctionsValid = Number(existing.sanctionsExp) > nowSec;
          if (kycValid && sanctionsValid) {
            return {
              status: 'existing',
              receipt: {
                receiptId: existing.receiptId.toString(),
                mask: existing.mask,
                kycExp: Number(existing.kycExp),
                sanctionsExp: Number(existing.sanctionsExp)
              }
            };
          }
        }
      } catch {
        // Chain read failed, proceed with fresh verification
      }
    }

    let credential;
    try {
      credential = await this.deps.credentialAdapter.verify(credentialProof, wallet);
    } catch {
      return { status: 'denied', reason: 'credential-invalid' };
    }
    if (!credential.valid) {
      return { status: 'denied', reason: 'credential-invalid' };
    }

    const authCheck = await verifyDepositorAuth({
      signature: depositorAuthSignature,
      wallet,
      credentialEvidenceHash: credential.credentialEvidenceHash as `0x${string}`,
      deadline: BigInt(deadline),
      nowSec: BigInt(nowSec)
    });
    if (!authCheck.valid) {
      return { status: 'denied', reason: 'credential-invalid' };
    }

    let sanctionsScreen;
    try {
      sanctionsScreen = await this.deps.sanctionsOracle.screen(wallet);
    } catch {
      return { status: 'denied', reason: 'internal-error' };
    }
    if (!sanctionsScreen.clear) {
      return { status: 'denied', reason: 'sanctions-hit' };
    }

    const policy = await this.deps.policyResolver.resolve(credential.jurisdictionCode);
    if (!policy) {
      return { status: 'denied', reason: 'policy-missing' };
    }

    const route = routeTranches(policy, credential.kycTier, sanctionsScreen.clear);
    if (!route.permitted) {
      return { status: 'denied', reason: 'jurisdiction-denied' };
    }

    const evidencePayload = JSON.stringify({
      credentialProof,
      sanctionsScreen,
      jurisdictionCode: credential.jurisdictionCode,
      kycTier: credential.kycTier
    });
    const evidenceKey = generateEvidenceKey();
    const encrypted = encryptEvidence(evidenceKey, evidencePayload);
    const serialized = serializeBlob(encrypted);

    const evidenceCid = await this.deps.pinEvidence(
      serialized.toString('base64'),
      this.deps.lighthouseApiKey
    );

    const sanctionsScreenCid = await this.deps.pinEvidence(
      JSON.stringify({ hash: sanctionsScreen.resultHash, screenedAtSec: sanctionsScreen.screenedAtSec }),
      this.deps.lighthouseApiKey
    );

    const draft = buildReceipt({
      wallet,
      credential,
      sanctionsScreen,
      sanctionsScreenCid,
      policy,
      policyCid: `ipfs://${policy.policyTokenId}`,
      policyResolvedAtBlock: 0,
      permittedTranchesMask: route.mask,
      evidenceBlobCid: evidenceCid,
      depositorAuthSignature,
      publisherAddress: this.deps.publisherAddress,
      identityNFT: this.deps.identityNFT,
      methodologyHash: this.deps.methodologyHash,
      codeCommit: this.deps.codeCommit,
      nowSec
    });

    const result = await this.deps.publisher.publishReceipt(draft);

    const approved: GateResult = {
      status: 'approved',
      receipt: result.receipt,
      receiptCid: result.receiptCid,
      evidenceCid,
      ...(result.txHash ? { txHash: result.txHash } : {})
    };
    return approved;
  }
}
