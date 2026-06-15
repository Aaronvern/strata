import { z } from 'zod';

const Address = z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'must be 0x-prefixed 20-byte address');
const Bytes32 = z.string().regex(/^0x[a-fA-F0-9]{64}$/, 'must be 0x-prefixed 32-byte hex');
const HexString = z.string().regex(/^0x[a-fA-F0-9]+$/, 'must be 0x-prefixed hex');

export const KycTier = z.enum(['none', 'basic', 'enhanced']);
export type KycTier = z.infer<typeof KycTier>;

export const CredentialProvider = z.enum(['zkpass', 'privado', 'stub', 'reclaim']);
export type CredentialProvider = z.infer<typeof CredentialProvider>;

// Bitmask: bit 0 = senior, bit 1 = mezzanine, bit 2 = junior
export function encodeTranchesMask(tranches: { senior: boolean; mezzanine: boolean; junior: boolean }): number {
  return (tranches.senior ? 1 : 0) | (tranches.mezzanine ? 2 : 0) | (tranches.junior ? 4 : 0);
}

export function decodeTranchesMask(mask: number): { senior: boolean; mezzanine: boolean; junior: boolean } {
  return {
    senior: (mask & 1) !== 0,
    mezzanine: (mask & 2) !== 0,
    junior: (mask & 4) !== 0
  };
}

export const DepositorAuthSchema = z.object({
  wallet: Address,
  credentialEvidenceHash: Bytes32,
  deadline: z.number().int().positive()
});
export type DepositorAuth = z.infer<typeof DepositorAuthSchema>;

export const SanctionsScreenResultSchema = z.object({
  wallet: Address,
  clear: z.boolean(),
  screenedAtSec: z.number().int().positive(),
  resultHash: Bytes32,
  provider: z.string().min(1)
});
export type SanctionsScreenResult = z.infer<typeof SanctionsScreenResultSchema>;

export const CredentialResultSchema = z.object({
  valid: z.boolean(),
  kycTier: KycTier,
  jurisdictionCode: z.string().min(1),
  credentialEvidenceHash: Bytes32,
  issuer: Address,
  provider: CredentialProvider
});
export type CredentialResult = z.infer<typeof CredentialResultSchema>;

export const PermittedTranchesByKycTierSchema = z.object({
  none: z.number().int().min(0).max(7),
  basic: z.number().int().min(0).max(7),
  enhanced: z.number().int().min(0).max(7)
});

export const JurisdictionPolicySchema = z.object({
  version: z.literal('1.0'),
  policyTokenId: z.string(),
  jurisdictionCode: z.string().min(1),
  effectiveFromSec: z.number().int().positive(),
  effectiveUntilSec: z.number().int().positive().nullable(),
  permittedTranchesByKycTier: PermittedTranchesByKycTierSchema,
  sourceTextHash: Bytes32,
  sourceTextCid: z.string().nullable(),
  aiInterpretationCid: z.string().nullable(),
  aiInterpretationHash: Bytes32.nullable(),
  aiModel: z.string().nullable(),
  aiPromptHash: Bytes32.nullable(),
  policyHash: Bytes32,
  publisher: z.object({ multisigAddress: Address, identityNFT: z.string() }),
  publishedAtSec: z.number().int().positive(),
  signatures: z.array(z.string())
});
export type JurisdictionPolicy = z.infer<typeof JurisdictionPolicySchema>;

export const ComplianceReceiptSchema = z.object({
  version: z.literal('1.0'),
  receiptId: z.string(),
  wallet: Address,
  policyTokenId: z.string(),
  policyCid: z.string(),
  policyHash: Bytes32,
  policyResolvedAtBlock: z.number().int().nonnegative(),
  kycTier: KycTier,
  jurisdictionCodeHash: Bytes32,
  sanctionsScreenCid: z.string(),
  sanctionsScreenAtSec: z.number().int().positive(),
  sanctionsClear: z.boolean(),
  permittedTranchesMask: z.number().int().min(0).max(7),
  credentialProvider: CredentialProvider,
  credentialEvidenceHash: Bytes32,
  evidenceBlobCid: z.string(),
  depositorAuthSignature: HexString,
  kycExpiresAtSec: z.number().int().positive(),
  sanctionsScreenExpiresAtSec: z.number().int().positive(),
  publisher: z.object({ address: Address, identityNFT: z.string() }),
  methodologyHash: Bytes32,
  codeCommit: z.string().min(1),
  publishedAtSec: z.number().int().positive(),
  signature: HexString
});
export type ComplianceReceipt = z.infer<typeof ComplianceReceiptSchema>;

export const DenialRecordSchema = z.object({
  wallet: Address,
  reason: z.enum([
    'sanctions-hit',
    'credential-invalid',
    'credential-expired',
    'jurisdiction-denied',
    'policy-revoked',
    'policy-missing',
    'internal-error'
  ]),
  deniedAtSec: z.number().int().positive(),
  evidenceBlobCid: z.string(),
  opaqueOutcomeHash: Bytes32
});
export type DenialRecord = z.infer<typeof DenialRecordSchema>;

export type GateResult =
  | { status: 'approved'; receipt: ComplianceReceipt; receiptCid: string; evidenceCid: string; txHash?: `0x${string}` }
  | { status: 'existing'; receipt: { receiptId: string; mask: number; kycExp: number; sanctionsExp: number } }
  | { status: 'denied'; reason: DenialRecord['reason']; denialCid?: string };
