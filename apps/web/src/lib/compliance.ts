'use client';

export type WebCredentialProof =
  | {
      kind?: 'stub';
      issuer: string;
      wallet: string;
      kycTier: 'none' | 'basic' | 'enhanced';
      jurisdictionCode: string;
      issuedAtSec: number;
      expiresAtSec: number;
      signature: string;
    }
  | { kind: 'reclaim'; proofs: unknown; providerVersion?: string };

export interface ComplianceCheckRequest {
  wallet: string;
  credentialProof: WebCredentialProof;
  depositorAuthSignature: string;
  deadline: number;
}

export interface ComplianceApproved {
  status: 'approved';
  receiptCid: string;
  permittedTranchesMask: number;
  kycExpiresAtSec: number;
  sanctionsScreenExpiresAtSec: number;
}

export interface ComplianceExisting {
  status: 'existing';
  receiptId: string;
  permittedTranchesMask: number;
  kycExpiresAtSec: number;
  sanctionsScreenExpiresAtSec: number;
}

export interface ComplianceDenied {
  status: 'denied';
  reason: string;
}

export type ComplianceResponse = ComplianceApproved | ComplianceExisting | ComplianceDenied;

const GATE_URL = process.env.NEXT_PUBLIC_COMPLIANCE_GATE_URL ?? 'http://localhost:9094';

export async function checkCompliance(body: ComplianceCheckRequest): Promise<ComplianceResponse> {
  const res = await fetch(`${GATE_URL}/api/v1/compliance/check`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });

  const data = await res.json();

  if (res.status === 403) {
    return { status: 'denied', reason: data.reason ?? 'unknown' };
  }

  if (!res.ok) {
    throw new Error(data.error ?? `Compliance gate returned ${res.status}`);
  }

  return data as ComplianceApproved | ComplianceExisting;
}

export async function fetchReclaimConfig(wallet: string): Promise<string> {
  const res = await fetch(`${GATE_URL}/api/v1/compliance/reclaim/config?wallet=${wallet}`);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error ?? `Reclaim config returned ${res.status}`);
  }
  return data.reclaimConfig as string;
}

export function decodeMask(mask: number): { senior: boolean; mezzanine: boolean; junior: boolean } {
  return {
    senior: (mask & 1) !== 0,
    mezzanine: (mask & 2) !== 0,
    junior: (mask & 4) !== 0
  };
}
