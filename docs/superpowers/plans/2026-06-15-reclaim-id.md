# Reclaim ID Compliance Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a production-shaped Reclaim Protocol credential adapter to the Strata Compliance Agent so a user proves exchange KYC via Reclaim, the agent verifies it off-chain, maps it to `kycTier`/`jurisdictionCode`, and issues the existing soulbound compliance receipt that gates deposits.

**Architecture:** New `reclaim` credential adapter implementing the existing `CredentialAdapter` seam in `agents/compliance`. The `credentialProof` input becomes a discriminated union (`stub` | `reclaim`); the configured adapter narrows it. The web app adds a QR proof step that binds the wallet into the proof context and forwards the proof to the unchanged `/api/v1/compliance/check`. No Solidity changes; sanctions/KMS/policies stay stubbed (documented go-live gates).

**Tech Stack:** TypeScript, Node, viem, zod, Fastify, vitest (agent); Next.js 14 App Router, wagmi/viem, `@reclaimprotocol/js-sdk`, `react-qr-code` (web). Package manager: `pnpm` (workspace).

**Spec:** `docs/superpowers/specs/2026-06-15-reclaim-id-design.md`

**Conventions:**
- Run agent tests: `pnpm --filter @strata/compliance test`
- Run agent build/type-check: `pnpm --filter @strata/compliance build`
- Run web type-check: `pnpm --filter @strata/web type-check`
- Commit messages: terse, prefixed (`compliance: …`, `web: …`), `Co-Authored-By` trailer kept.
- **GitHub gets ONE commit:** commit locally per task; Task 11 squashes the branch to a single commit before any push.

**Key decisions locked (from spec §2.1):**
- `credentialEvidenceHash` for Reclaim = the proof's top-level `identifier` (already a signed bytes32). Client and adapter both read the same field — no canonicalization coupling.
- Wallet binding = `data[0].context.address === wallet` (set server-side at request init) **plus** the existing `DepositorAuth` EIP-712.
- `jurisdictionCode` defaults to `permissionless` this build (no country proof); `kycTier` from the KYC-status field.

---

### Task 0: Add Reclaim SDK dependency to the compliance agent

**Files:**
- Modify: `agents/compliance/package.json`

- [ ] **Step 1: Install the SDK in the compliance workspace**

Run: `pnpm --filter @strata/compliance add @reclaimprotocol/js-sdk`
Expected: `package.json` gains `@reclaimprotocol/js-sdk` under `dependencies`; lockfile updates; install succeeds.

- [ ] **Step 2: Verify the existing test suite still passes**

Run: `pnpm --filter @strata/compliance test`
Expected: PASS (no behavior changed yet).

- [ ] **Step 3: Commit**

```bash
git add agents/compliance/package.json pnpm-lock.yaml
git commit -m "compliance: add @reclaimprotocol/js-sdk dependency

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 1: Add `reclaim` provider + credential input union

**Files:**
- Modify: `agents/compliance/src/types.ts:10`
- Modify: `agents/compliance/src/adapters/credential.ts`
- Modify: `agents/compliance/src/adapters/stubCredential.ts:83-137`
- Modify: `agents/compliance/src/pipeline/gateOrchestrator.ts:1,28-33`
- Test: `agents/compliance/tests/unit/credentialInput.test.ts`

- [ ] **Step 1: Write the failing test**

Create `agents/compliance/tests/unit/credentialInput.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @strata/compliance test credentialInput`
Expected: FAIL — `isReclaimProof` is not exported / `'reclaim'` not in enum.

- [ ] **Step 3: Add `reclaim` to the provider enum**

In `agents/compliance/src/types.ts`, change line 10:

```ts
export const CredentialProvider = z.enum(['zkpass', 'privado', 'stub', 'reclaim']);
```

- [ ] **Step 4: Rewrite the credential adapter interface as a union**

Replace the entire contents of `agents/compliance/src/adapters/credential.ts` with:

```ts
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
```

- [ ] **Step 5: Make the stub adapter accept the union and reject reclaim input**

In `agents/compliance/src/adapters/stubCredential.ts`, update the import on line 7 and the `verify` signature. Change line 7 from:

```ts
import type { CredentialAdapter, CredentialProof } from './credential.js';
```
to:
```ts
import type { CredentialAdapter, CredentialProof, CredentialProofInput } from './credential.js';
import { isReclaimProof } from './credential.js';
```

Then change the `verify` method signature (line 91) and add a guard as its first statements:

```ts
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
      // ...existing body unchanged, now operating on the narrowed `proof`...
```

(The rest of the method body — `proof.wallet`, `proof.expiresAtSec`, etc. — is unchanged; after the guard, `proof` narrows to `CredentialProof`.)

- [ ] **Step 6: Generalize the orchestrator's credential param type**

In `agents/compliance/src/pipeline/gateOrchestrator.ts`, change line 1:

```ts
import type { CredentialAdapter, CredentialProofInput } from '../adapters/credential.js';
```

and change the `runGateCycle` signature (line 30) from `credentialProof: CredentialProof` to:

```ts
    credentialProof: CredentialProofInput,
```

- [ ] **Step 7: Run tests to verify pass and no regressions**

Run: `pnpm --filter @strata/compliance test`
Expected: PASS — new `credentialInput` tests pass; existing `gateOrchestrator`/`buildReceipt`/stub tests still pass (`zkpass` still valid, `CredentialProof` still exported).

- [ ] **Step 8: Commit**

```bash
git add agents/compliance/src/types.ts agents/compliance/src/adapters/credential.ts agents/compliance/src/adapters/stubCredential.ts agents/compliance/src/pipeline/gateOrchestrator.ts agents/compliance/tests/unit/credentialInput.test.ts
git commit -m "compliance: add reclaim provider + credential input union

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Reclaim provider profiles + mapping

**Files:**
- Create: `agents/compliance/src/adapters/reclaimProfiles.ts`
- Test: `agents/compliance/tests/unit/reclaimProfiles.test.ts`

- [ ] **Step 1: Write the failing test**

Create `agents/compliance/tests/unit/reclaimProfiles.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  getProfile,
  mapExtractedParams,
  EXCHANGE_KYC_PROFILE,
  DEMO_PROFILE,
  type ReclaimProfile
} from '../../src/adapters/reclaimProfiles.js';

describe('reclaim profiles', () => {
  it('getProfile returns known profiles and throws on unknown', () => {
    expect(getProfile('exchange-kyc').name).toBe('exchange-kyc');
    expect(getProfile('demo').name).toBe('demo');
    expect(() => getProfile('nope')).toThrow();
  });

  it('exchange profile: verified -> basic + permissionless default', () => {
    const r = mapExtractedParams(EXCHANGE_KYC_PROFILE, { kycStatus: 'verified' });
    expect(r).toEqual({ kycTier: 'basic', jurisdictionCode: 'permissionless' });
  });

  it('exchange profile: advanced -> enhanced', () => {
    const r = mapExtractedParams(EXCHANGE_KYC_PROFILE, { kycStatus: 'advanced' });
    expect(r?.kycTier).toBe('enhanced');
  });

  it('exchange profile: unknown status, no tier default -> deny (null)', () => {
    expect(mapExtractedParams(EXCHANGE_KYC_PROFILE, { kycStatus: 'pending' })).toBeNull();
  });

  it('demo profile: empty params -> basic + permissionless via defaults', () => {
    expect(mapExtractedParams(DEMO_PROFILE, {})).toEqual({
      kycTier: 'basic',
      jurisdictionCode: 'permissionless'
    });
  });

  it('country mapping resolves jurisdiction when configured', () => {
    const p: ReclaimProfile = {
      name: 'test',
      statusField: 'kycStatus',
      statusToTier: { verified: 'basic' },
      countryField: 'country',
      countryToJurisdiction: { GB: 'GB', DE: 'EU' }
    };
    expect(mapExtractedParams(p, { kycStatus: 'verified', country: 'DE' })).toEqual({
      kycTier: 'basic',
      jurisdictionCode: 'EU'
    });
    // country present but unmapped, no default -> deny
    expect(mapExtractedParams(p, { kycStatus: 'verified', country: 'ZZ' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @strata/compliance test reclaimProfiles`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `agents/compliance/src/adapters/reclaimProfiles.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @strata/compliance test reclaimProfiles`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agents/compliance/src/adapters/reclaimProfiles.ts agents/compliance/tests/unit/reclaimProfiles.test.ts
git commit -m "compliance: reclaim provider profiles + deny-by-default mapping

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Reclaim credential adapter

**Files:**
- Create: `agents/compliance/src/adapters/reclaimCredential.ts`
- Test: `agents/compliance/tests/unit/reclaimCredential.test.ts`

- [ ] **Step 1: Write the failing test (mocks the SDK — no network)**

Create `agents/compliance/tests/unit/reclaimCredential.test.ts`:

```ts
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

beforeEach(() => vi.mocked(verifyProof).mockReset());

describe('reclaim credential adapter', () => {
  it('valid verified proof -> basic + permissionless, evidence hash = identifier', async () => {
    vi.mocked(verifyProof).mockResolvedValue({
      isVerified: true,
      data: [{ context: { address: WALLET }, extractedParameters: { kycStatus: 'verified' } }]
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
      data: [{ context: { address: '0x9999999999999999999999999999999999999999' }, extractedParameters: { kycStatus: 'verified' } }]
    } as never);
    const r = await adapter().verify({ kind: 'reclaim', proofs: [fixtureProof()] }, WALLET);
    expect(r.valid).toBe(false);
  });

  it('stale proof -> invalid', async () => {
    vi.mocked(verifyProof).mockResolvedValue({
      isVerified: true,
      data: [{ context: { address: WALLET }, extractedParameters: { kycStatus: 'verified' } }]
    } as never);
    const stale = fixtureProof({ claimData: { provider: 'http', timestampS: NOW - 10_000, context: '{}' } });
    const r = await adapter().verify({ kind: 'reclaim', proofs: [stale] }, WALLET);
    expect(r.valid).toBe(false);
  });

  it('unmappable status -> invalid', async () => {
    vi.mocked(verifyProof).mockResolvedValue({
      isVerified: true,
      data: [{ context: { address: WALLET }, extractedParameters: { kycStatus: 'pending' } }]
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @strata/compliance test reclaimCredential`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `agents/compliance/src/adapters/reclaimCredential.ts`:

```ts
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
        context?: { address?: string };
        extractedParameters?: Record<string, unknown>;
      };

      // 1) wallet binding (context.address is part of the signed claim)
      const ctxAddress = String(datum?.context?.address ?? '').toLowerCase();
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @strata/compliance test reclaimCredential`
Expected: PASS (all 6 cases).

- [ ] **Step 5: Commit**

```bash
git add agents/compliance/src/adapters/reclaimCredential.ts agents/compliance/tests/unit/reclaimCredential.test.ts
git commit -m "compliance: reclaim credential adapter with wallet binding + freshness

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Config — Reclaim env vars + validation

**Files:**
- Modify: `agents/compliance/src/config.ts`
- Test: `agents/compliance/tests/unit/config.test.ts`

- [ ] **Step 1: Write the failing test**

Create `agents/compliance/tests/unit/config.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from '../../src/config.js';

const BASE = {
  MANTLE_RPC_URL: 'https://rpc.mantle.xyz',
  COMPLIANCE_PRIVATE_KEY: '0x' + '11'.repeat(32),
  LIGHTHOUSE_API_KEY: 'key',
  COMPLIANCE_DRY_RUN: 'true'
};

let saved: NodeJS.ProcessEnv;
beforeEach(() => { saved = { ...process.env }; });
afterEach(() => { process.env = saved; });

function setEnv(extra: Record<string, string>) {
  process.env = { ...BASE, ...extra } as NodeJS.ProcessEnv;
}

describe('config credential provider', () => {
  it('defaults to stub', () => {
    setEnv({});
    expect(loadConfig().credential.provider).toBe('stub');
  });

  it('reclaim without app id throws', () => {
    setEnv({ CREDENTIAL_PROVIDER: 'reclaim' });
    expect(() => loadConfig()).toThrow(/RECLAIM/);
  });

  it('reclaim with required vars resolves', () => {
    setEnv({
      CREDENTIAL_PROVIDER: 'reclaim',
      RECLAIM_APP_ID: 'app',
      RECLAIM_APP_SECRET: 'secret',
      RECLAIM_PROVIDER_ID: 'prov',
      RECLAIM_PROFILE: 'exchange-kyc'
    });
    const c = loadConfig();
    expect(c.credential.provider).toBe('reclaim');
    expect(c.credential.reclaim.providerId).toBe('prov');
    expect(c.credential.reclaim.profile).toBe('exchange-kyc');
    expect(c.credential.reclaim.proofMaxAgeSec).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @strata/compliance test config`
Expected: FAIL — `credential` not on config.

- [ ] **Step 3: Add the env fields**

In `agents/compliance/src/config.ts`, add these keys inside the `Env = z.object({ ... })` (after line 14, before the closing `})`):

```ts
  CREDENTIAL_PROVIDER: z.enum(['stub', 'reclaim']).default('stub'),
  RECLAIM_APP_ID: z.string().optional(),
  RECLAIM_APP_SECRET: z.string().optional(),
  RECLAIM_PROVIDER_ID: z.string().optional(),
  RECLAIM_PROVIDER_VERSION: z.string().default('1.0.0'),
  RECLAIM_PROFILE: z.string().default('demo'),
  RECLAIM_PROOF_MAX_AGE_SEC: z.coerce.number().int().positive().default(900),
  RECLAIM_CALLBACK_BASE_URL: z.string().url().optional(),
```

- [ ] **Step 4: Add validation + return shape**

In `loadConfig`, after the existing dry-run validation block (after line 31), add:

```ts
  if (env.CREDENTIAL_PROVIDER === 'reclaim') {
    const missing = (['RECLAIM_APP_ID', 'RECLAIM_APP_SECRET', 'RECLAIM_PROVIDER_ID'] as const)
      .filter((k) => !env[k]);
    if (missing.length > 0) {
      throw new Error(`Config error: ${missing.join(', ')} required when CREDENTIAL_PROVIDER=reclaim`);
    }
  }
```

Then add a `credential` block to the returned object (inside the `return { ... } as const`, alongside `compliance`/`ipfs`):

```ts
    credential: {
      provider: env.CREDENTIAL_PROVIDER,
      reclaim: {
        appId: env.RECLAIM_APP_ID ?? '',
        appSecret: env.RECLAIM_APP_SECRET ?? '',
        providerId: env.RECLAIM_PROVIDER_ID ?? '',
        providerVersion: env.RECLAIM_PROVIDER_VERSION,
        profile: env.RECLAIM_PROFILE,
        proofMaxAgeSec: env.RECLAIM_PROOF_MAX_AGE_SEC,
        callbackBaseUrl: env.RECLAIM_CALLBACK_BASE_URL ?? ''
      }
    },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @strata/compliance test config`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add agents/compliance/src/config.ts agents/compliance/tests/unit/config.test.ts
git commit -m "compliance: config for reclaim credential provider

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Wire adapter + Reclaim config provider into the gate bootstrap

**Files:**
- Modify: `agents/compliance/src/gate.ts`

> No unit test — this is composition/bootstrap; verified by build + the server test in Task 6. `addContext` / `setAppCallbackUrl` are SDK methods to confirm against the installed version (spec §12); if names differ, adjust here only.

- [ ] **Step 1: Add imports**

In `agents/compliance/src/gate.ts`, after line 8 (`createStubCredentialAdapter` import) add:

```ts
import { createReclaimCredentialAdapter } from './adapters/reclaimCredential.js';
import { getProfile } from './adapters/reclaimProfiles.js';
```

- [ ] **Step 2: Select the adapter by config**

Replace line 49 (`const credentialAdapter = createStubCredentialAdapter();`) with:

```ts
  const credentialAdapter =
    cfg.credential.provider === 'reclaim'
      ? createReclaimCredentialAdapter({
          providerId: cfg.credential.reclaim.providerId,
          providerVersion: cfg.credential.reclaim.providerVersion,
          profile: getProfile(cfg.credential.reclaim.profile),
          maxAgeSec: cfg.credential.reclaim.proofMaxAgeSec
        })
      : createStubCredentialAdapter();
```

- [ ] **Step 3: Build a `reclaimConfigProvider` for the server**

Immediately before `const server = await buildServer(...)` (line 88), add:

```ts
  let reclaimConfigProvider: ((wallet: `0x${string}`) => Promise<string>) | undefined;
  if (cfg.credential.provider === 'reclaim') {
    const { ReclaimProofRequest } = await import('@reclaimprotocol/js-sdk');
    reclaimConfigProvider = async (wallet: `0x${string}`) => {
      const req = await ReclaimProofRequest.init(
        cfg.credential.reclaim.appId,
        cfg.credential.reclaim.appSecret,
        cfg.credential.reclaim.providerId
      );
      // Bind the depositor wallet into the signed proof context.
      req.addContext(wallet, 'Strata deposit compliance');
      if (cfg.credential.reclaim.callbackBaseUrl) {
        req.setAppCallbackUrl(
          `${cfg.credential.reclaim.callbackBaseUrl}/api/v1/compliance/reclaim/callback`,
          true
        );
      }
      return req.toJsonString();
    };
  }
```

Then change the `buildServer` call (line 88) to pass it:

```ts
  const server = await buildServer({ orchestrator, health, metrics, reclaimConfigProvider });
```

- [ ] **Step 4: Verify build**

Run: `pnpm --filter @strata/compliance build`
Expected: PASS (tsc clean). If `addContext`/`setAppCallbackUrl` type errors appear, confirm method names against the installed `@reclaimprotocol/js-sdk` version and adjust.

- [ ] **Step 5: Commit**

```bash
git add agents/compliance/src/gate.ts
git commit -m "compliance: wire reclaim adapter + config provider into gate

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: API server — accept reclaim variant + config endpoint

**Files:**
- Modify: `agents/compliance/src/api/server.ts`
- Test: `agents/compliance/tests/unit/server.test.ts`

- [ ] **Step 1: Write the failing test**

Create `agents/compliance/tests/unit/server.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { buildServer } from '../../src/api/server.js';
import { makeHealth } from '../../src/monitor/health.js';
import { makeMetrics } from '../../src/monitor/metrics.js';

const WALLET = '0x2222222222222222222222222222222222222222';

function approvedOrchestrator() {
  return {
    runGateCycle: vi.fn(async () => ({
      status: 'approved' as const,
      receipt: { permittedTranchesMask: 4, kycExpiresAtSec: 123, sanctionsScreenExpiresAtSec: 456 },
      receiptCid: 'QmReceipt',
      evidenceCid: 'QmEvidence'
    }))
  } as never;
}

describe('compliance server', () => {
  it('accepts a reclaim credentialProof and returns approved', async () => {
    const app = await buildServer({
      orchestrator: approvedOrchestrator(),
      health: makeHealth(),
      metrics: makeMetrics(),
      reclaimConfigProvider: async () => '{"json":"config"}'
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/compliance/check',
      payload: {
        wallet: WALLET,
        credentialProof: { kind: 'reclaim', proofs: [{ identifier: '0x' + 'ab'.repeat(32) }] },
        depositorAuthSignature: '0xabcd',
        deadline: 2_000_000_000
      }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('approved');
    await app.close();
  });

  it('serves a reclaim config for a valid wallet', async () => {
    const app = await buildServer({
      orchestrator: approvedOrchestrator(),
      health: makeHealth(),
      metrics: makeMetrics(),
      reclaimConfigProvider: async () => '{"json":"config"}'
    });
    const res = await app.inject({ method: 'GET', url: `/api/v1/compliance/reclaim/config?wallet=${WALLET}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().reclaimConfig).toBe('{"json":"config"}');
    await app.close();
  });

  it('reclaim config 400 on missing wallet', async () => {
    const app = await buildServer({
      orchestrator: approvedOrchestrator(),
      health: makeHealth(),
      metrics: makeMetrics(),
      reclaimConfigProvider: async () => 'x'
    });
    const res = await app.inject({ method: 'GET', url: '/api/v1/compliance/reclaim/config' });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('reclaim config 404 when provider disabled', async () => {
    const app = await buildServer({
      orchestrator: approvedOrchestrator(),
      health: makeHealth(),
      metrics: makeMetrics()
    });
    const res = await app.inject({ method: 'GET', url: `/api/v1/compliance/reclaim/config?wallet=${WALLET}` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @strata/compliance test server`
Expected: FAIL — reclaim payload rejected by the strict schema / config route missing.

- [ ] **Step 3: Replace the request schema with a union**

In `agents/compliance/src/api/server.ts`, replace the `CheckRequestSchema` block (lines 12-25) with:

```ts
const StubCredentialProofSchema = z.object({
  kind: z.literal('stub').optional(),
  issuer: Address,
  wallet: Address,
  kycTier: z.enum(['none', 'basic', 'enhanced']),
  jurisdictionCode: z.string().min(1),
  issuedAtSec: z.number().int().positive(),
  expiresAtSec: z.number().int().positive(),
  signature: HexString
});

const ReclaimCredentialProofSchema = z.object({
  kind: z.literal('reclaim'),
  proofs: z.union([z.array(z.record(z.any())), z.record(z.any())]),
  providerVersion: z.string().optional()
});

const CredentialProofInputSchema = z.union([ReclaimCredentialProofSchema, StubCredentialProofSchema]);

const CheckRequestSchema = z.object({
  wallet: Address,
  credentialProof: CredentialProofInputSchema,
  depositorAuthSignature: HexString,
  deadline: z.number().int().positive()
});
```

- [ ] **Step 4: Add `reclaimConfigProvider` to `ServerDeps`**

Replace the `ServerDeps` interface (lines 27-31) with:

```ts
export interface ServerDeps {
  orchestrator: GateOrchestrator;
  health: HealthState;
  metrics: ComplianceMetrics;
  reclaimConfigProvider?: (wallet: `0x${string}`) => Promise<string>;
}
```

- [ ] **Step 5: Add the config endpoint**

In `buildServer`, after the `/api/v1/compliance/check` handler (after line 93) add:

```ts
  app.get('/api/v1/compliance/reclaim/config', async (request, reply) => {
    const wallet = (request.query as { wallet?: string })?.wallet;
    if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
      return reply.status(400).send({ error: 'invalid_wallet' });
    }
    if (!deps.reclaimConfigProvider) {
      return reply.status(404).send({ error: 'reclaim_not_enabled' });
    }
    try {
      const reclaimConfig = await deps.reclaimConfigProvider(wallet as `0x${string}`);
      return reply.status(200).send({ reclaimConfig });
    } catch {
      return reply.status(500).send({ error: 'reclaim_config_failed' });
    }
  });
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @strata/compliance test server`
Expected: PASS (4 cases).

- [ ] **Step 7: Run the full agent suite + build**

Run: `pnpm --filter @strata/compliance test && pnpm --filter @strata/compliance build`
Expected: PASS — all tests green, tsc clean.

- [ ] **Step 8: Commit**

```bash
git add agents/compliance/src/api/server.ts agents/compliance/tests/unit/server.test.ts
git commit -m "compliance: accept reclaim proof variant + serve proof-request config

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Web — compliance client (union request + fetchReclaimConfig)

**Files:**
- Modify: `apps/web/src/lib/compliance.ts`

> Web has no test runner; verification is `type-check` + the manual smoke in Task 11.

- [ ] **Step 1: Replace the request type with a union and add the config fetch**

In `apps/web/src/lib/compliance.ts`, replace the `ComplianceCheckRequest` interface (lines 3-16) with:

```ts
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
```

Then, after the `checkCompliance` function (after line 61), add:

```ts
export async function fetchReclaimConfig(wallet: string): Promise<string> {
  const res = await fetch(`${GATE_URL}/api/v1/compliance/reclaim/config?wallet=${wallet}`);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error ?? `Reclaim config returned ${res.status}`);
  }
  return data.reclaimConfig as string;
}
```

- [ ] **Step 2: Verify type-check**

Run: `pnpm --filter @strata/web type-check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/compliance.ts
git commit -m "web: compliance client supports reclaim proof + config fetch

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Web — ReclaimVerify component

**Files:**
- Modify: `apps/web/package.json`
- Create: `apps/web/src/components/app/ReclaimVerify.tsx`

- [ ] **Step 1: Install web dependencies**

Run: `pnpm --filter @strata/web add @reclaimprotocol/js-sdk react-qr-code`
Expected: both added to `apps/web/package.json` dependencies; install succeeds.

- [ ] **Step 2: Create the component**

Create `apps/web/src/components/app/ReclaimVerify.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useSignTypedData } from 'wagmi';
import QRCode from 'react-qr-code';
import { ReclaimProofRequest } from '@reclaimprotocol/js-sdk';
import { fetchReclaimConfig, checkCompliance } from '@/lib/compliance';

const BYTES32 = /^0x[a-fA-F0-9]{64}$/;

type Status = 'idle' | 'loading' | 'ready' | 'verifying' | 'success' | 'error';

export function ReclaimVerify({
  wallet,
  onVerified
}: {
  wallet: `0x${string}`;
  onVerified: () => void;
}) {
  const [status, setStatus] = useState<Status>('idle');
  const [requestUrl, setRequestUrl] = useState('');
  const [message, setMessage] = useState('');
  const { signTypedDataAsync } = useSignTypedData();

  async function start() {
    try {
      setStatus('loading');
      const cfg = await fetchReclaimConfig(wallet);
      const req = await ReclaimProofRequest.fromJsonString(cfg);
      const url = await req.getRequestUrl();
      setRequestUrl(url);
      setStatus('ready');

      await req.startSession({
        onSuccess: async (proofs: unknown) => {
          try {
            setStatus('verifying');
            const arr = Array.isArray(proofs) ? proofs : [proofs];
            const first = arr[0] as { identifier?: string };
            const credentialEvidenceHash = String(first?.identifier ?? '');
            if (!BYTES32.test(credentialEvidenceHash)) {
              throw new Error('proof missing a valid identifier');
            }
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const depositorAuthSignature = await signTypedDataAsync({
              domain: { name: 'StrataCompliance', version: '1', chainId: 5000 },
              types: {
                DepositorAuth: [
                  { name: 'wallet', type: 'address' },
                  { name: 'credentialEvidenceHash', type: 'bytes32' },
                  { name: 'deadline', type: 'uint256' }
                ]
              },
              primaryType: 'DepositorAuth',
              message: {
                wallet,
                credentialEvidenceHash: credentialEvidenceHash as `0x${string}`,
                deadline: BigInt(deadline)
              }
            });

            const res = await checkCompliance({
              wallet,
              credentialProof: { kind: 'reclaim', proofs: arr },
              depositorAuthSignature,
              deadline
            });

            if (res.status === 'denied') {
              setMessage(`Denied: ${res.reason}`);
              setStatus('error');
              return;
            }
            setStatus('success');
            onVerified();
          } catch (e) {
            setMessage((e as Error).message);
            setStatus('error');
          }
        },
        onError: (e: unknown) => {
          setMessage(String(e));
          setStatus('error');
        }
      });
    } catch (e) {
      setMessage((e as Error).message);
      setStatus('error');
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      {status === 'idle' && (
        <button className="btn-app btn-primary" onClick={start}>
          Verify with Reclaim
        </button>
      )}
      {status === 'loading' && <p className="a-muted mono">Initializing verification…</p>}
      {status === 'ready' && requestUrl && (
        <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
          <p className="a-muted" style={{ fontSize: 12.5 }}>Scan with your phone to prove your exchange KYC:</p>
          <div style={{ background: '#fff', padding: 12, borderRadius: 8 }}>
            <QRCode value={requestUrl} size={180} />
          </div>
        </div>
      )}
      {status === 'verifying' && <p className="a-muted mono">Verifying proof and minting receipt…</p>}
      {status === 'success' && <p className="mono" style={{ color: 'var(--green)' }}>Verified — receipt issued.</p>}
      {status === 'error' && (
        <div style={{ textAlign: 'center' }}>
          <p className="mono" style={{ color: 'var(--accent)', fontSize: 12 }}>{message || 'Verification failed.'}</p>
          <button className="btn-app btn-ghost" onClick={() => setStatus('idle')}>Retry</button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify type-check**

Run: `pnpm --filter @strata/web type-check`
Expected: PASS. If `startSession`/`fromJsonString`/`getRequestUrl` type signatures differ in the installed SDK version, adjust call sites to match (spec §12).

- [ ] **Step 4: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/src/components/app/ReclaimVerify.tsx
git commit -m "web: ReclaimVerify QR component + DepositorAuth signing

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Web — wire ReclaimVerify into the deposit flow

**Files:**
- Modify: `apps/web/src/hooks/useComplianceReceipt.ts:22-35`
- Modify: `apps/web/src/components/app/DepositView.tsx:9-18,114-118`

- [ ] **Step 1: Expose `refetch` from the receipt hook**

In `apps/web/src/hooks/useComplianceReceipt.ts`, change the hook to return `refetch`. Replace lines 22-35 with:

```ts
export function useComplianceReceipt(wallet?: `0x${string}`): {
  tokenId: bigint | null;
  loading: boolean;
  refetch: () => void;
} {
  const enabled = !!wallet;
  const { data, isLoading, refetch } = useReadContract({
    address: COMPLIANCE_REGISTRY,
    abi: REGISTRY_ABI,
    functionName: 'receiptOf',
    args: enabled ? [wallet!] : undefined,
    query: { enabled }
  });

  if (!enabled) return { tokenId: null, loading: false, refetch: () => {} };
  if (isLoading || data === undefined) return { tokenId: null, loading: true, refetch: () => { void refetch(); } };
  return { tokenId: data as bigint, loading: false, refetch: () => { void refetch(); } };
}
```

- [ ] **Step 2: Render ReclaimVerify for connected-but-unwhitelisted wallets**

In `apps/web/src/components/app/DepositView.tsx`, add the import after line 10:

```ts
import { ReclaimVerify } from './ReclaimVerify';
```

Change line 17 to also pull `refetch`:

```ts
  const { tokenId, loading, refetch } = useComplianceReceipt(isConnected ? address : undefined);
```

Then replace the existing not-whitelisted notice (lines 114-118) with a Reclaim verify step when enabled, falling back to the contact-team copy:

```tsx
        {isConnected && address && !loading && !whitelisted && (
          process.env.NEXT_PUBLIC_RECLAIM_ENABLED === '1' ? (
            <div style={{ width: '100%', marginTop: 8 }}>
              <p className="a-muted mono" style={{ fontSize: 11.5, maxWidth: 460, lineHeight: 1.55, margin: '0 auto 12px' }}>
                Reuse your exchange KYC to unlock deposits — no documents, no PII shared.
              </p>
              <ReclaimVerify wallet={address} onVerified={() => refetch()} />
            </div>
          ) : (
            <p className="a-muted mono" style={{ fontSize: 11.5, maxWidth: 460, lineHeight: 1.55, margin: 0 }}>
              This wallet is not yet whitelisted for the beta deposit. Contact the team to be added.
            </p>
          )
        )}
```

- [ ] **Step 3: Verify type-check**

Run: `pnpm --filter @strata/web type-check`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/hooks/useComplianceReceipt.ts apps/web/src/components/app/DepositView.tsx
git commit -m "web: surface Reclaim verify step in deposit flow + receipt refetch

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Documentation

**Files:**
- Create: `agents/compliance/docs/reclaim-adapter.md`
- Modify: `agents/compliance/docs/strategy-v1.md:33-39`

- [ ] **Step 1: Write the adapter doc**

Create `agents/compliance/docs/reclaim-adapter.md`:

```markdown
# Reclaim credential adapter

The Reclaim adapter is the real v2 credential source for the deposit gate. It
verifies a Reclaim Protocol zkTLS proof off-chain and maps it to `kycTier` +
`jurisdictionCode`, then the existing pipeline screens sanctions, resolves the
jurisdiction policy, and mints the soulbound compliance receipt. No contract
changes.

## Enable it

Set in the compliance agent environment:

```
CREDENTIAL_PROVIDER=reclaim
RECLAIM_APP_ID=<from dev.reclaimprotocol.org>
RECLAIM_APP_SECRET=<server-side only — never in the web app>
RECLAIM_PROVIDER_ID=<the exchange-KYC provider id>
RECLAIM_PROVIDER_VERSION=<provider version>
RECLAIM_PROFILE=exchange-kyc
RECLAIM_PROOF_MAX_AGE_SEC=900
# optional, only if the SDK version needs a public callback:
RECLAIM_CALLBACK_BASE_URL=https://<public-host>
```

Web app: set `NEXT_PUBLIC_RECLAIM_ENABLED=1` and (if not default)
`NEXT_PUBLIC_COMPLIANCE_GATE_URL`.

## Mapping

`src/adapters/reclaimProfiles.ts` holds declarative profiles. `exchange-kyc`
maps the KYC-status field to a tier and defaults `jurisdictionCode` to
`permissionless` (junior-only). To enable US/EU/GB routing, add `countryField`
+ `countryToJurisdiction` to the profile — config only, no code change.

## Wallet binding

Two layers: the proof's `context.address` (set server-side at request init) must
equal the depositor wallet, and the user signs a `DepositorAuth` EIP-712 over
the proof identifier. `credentialEvidenceHash` is the proof's signed
`identifier`.

## Go-live gates (still stubbed)

Real sanctions oracle, KMS key custody, real jurisdiction policies, a paid
Reclaim plan, and the legal layer. See the design spec §11.
```

- [ ] **Step 2: Update the v2 scope note to point at the adapter**

In `agents/compliance/docs/strategy-v1.md`, change the v2 bullet (line 35) from:

```
- Real credential adapters (zkPass, Privado ID)
```
to:
```
- Real credential adapters: Reclaim Protocol shipped (see reclaim-adapter.md); zkPass / Privado ID optional
```

- [ ] **Step 3: Commit**

```bash
git add agents/compliance/docs/reclaim-adapter.md agents/compliance/docs/strategy-v1.md
git commit -m "docs: reclaim adapter usage + v2 scope update

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Full verification + squash to a single GitHub commit

**Files:** none (verification + git).

- [ ] **Step 1: Run the full agent suite**

Run: `pnpm --filter @strata/compliance test`
Expected: PASS — all unit tests (credentialInput, reclaimProfiles, reclaimCredential, config, server, plus pre-existing gateOrchestrator/buildReceipt/etc.) green.

- [ ] **Step 2: Build the agent and type-check the web app**

Run: `pnpm --filter @strata/compliance build && pnpm --filter @strata/web type-check`
Expected: both PASS (tsc clean).

- [ ] **Step 3: Manual smoke (demo profile, no Reclaim account needed)**

Start the gate with `CREDENTIAL_PROVIDER=reclaim`, `RECLAIM_PROFILE=demo`, `COMPLIANCE_DRY_RUN=true`, dummy `RECLAIM_APP_ID/SECRET/PROVIDER_ID`, and confirm:
- `GET http://localhost:9094/api/v1/compliance/reclaim/config?wallet=0x…2222` returns `{ reclaimConfig: "…" }` (or a clear SDK error if app creds are placeholders — that confirms the route is wired).
- `GET /healthz` returns 200.

Run: `pnpm --filter @strata/compliance dev:gate`
Expected: server listens on 9094; the config route responds (200 with real creds, or a 500 `reclaim_config_failed` with placeholder creds — both confirm wiring).

- [ ] **Step 4: Squash the whole branch into one commit for GitHub**

The branch base is `da64e06` (main tip when the branch was created). Collapse every local commit (design spec + all tasks) into one:

```bash
git reset --soft da64e06
git commit -m "feat: reclaim id compliance credential adapter

Off-chain Reclaim Protocol KYC verification wired into the existing
compliance deposit gate: new reclaim credential adapter + provider
profiles, config endpoint, and a web QR verify step. No contract
changes; sanctions/KMS/policies remain stubbed (go-live gates).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

Run: `git log --oneline da64e06..HEAD`
Expected: exactly ONE commit listed.

- [ ] **Step 5: Confirm working tree is clean**

Run: `git status`
Expected: `nothing to commit, working tree clean`. (Push is left to you — do not push without the user's go-ahead.)

---

## Self-Review

**1. Spec coverage:**
- §2 off-chain adapter → Tasks 1,3,5. ✓
- §2.1 provider/profile/jurisdiction defaults → Task 2 (`EXCHANGE_KYC_PROFILE`, permissionless default). ✓
- §4.1 adapter verify (verifyProof, binding, freshness, mapping, evidence hash, issuer) → Task 3. ✓
- §4.2 declarative profiles, deny-by-default → Task 2. ✓
- §4.3 config endpoint + union request schema → Tasks 5,6. ✓
- §4.4 config env → Task 4. ✓
- §4.5 discriminated union + back-compat + provider enum → Task 1. ✓
- §5 web ReclaimVerify + compliance lib + DepositView wiring → Tasks 7,8,9. ✓
- §6 dual binding (context.address + DepositorAuth) → Task 3 (binding) + Task 8 (DepositorAuth signing). ✓
- §7 fail-closed error handling → Task 3 (`invalid()` on every failure path) + existing orchestrator denials. ✓
- §8 evidence reuse (identifier as hash, proof into existing evidence payload) → Task 3 + unchanged orchestrator evidence step. ✓
- §9 testing (mocked verifyProof, profile cases, config, server) → Tasks 1-6 tests. ✓
- §11 go-live gates documented → Task 10. ✓
- §12 SDK details to verify → flagged in Tasks 5 & 8. ✓
- One-commit-on-GitHub constraint → Task 11. ✓

**2. Placeholder scan:** No "TBD/TODO/handle edge cases" left in steps. The only intentional unknowns are the SDK method names (`addContext`/`setAppCallbackUrl`/`startSession`) flagged for version confirmation in Tasks 5 & 8, and the real `RECLAIM_PROVIDER_ID` (a deployment value, not code). ✓

**3. Type consistency:** `CredentialProofInput`, `isReclaimProof`, `CredentialAdapter.verify(proof, wallet)`, `ReclaimProfile`, `mapExtractedParams`, `getProfile`, `createReclaimCredentialAdapter`, `ReclaimAdapterOptions`, `ServerDeps.reclaimConfigProvider`, `fetchReclaimConfig`, `useComplianceReceipt().refetch`, and the `DepositorAuth` domain/types are named identically across the tasks that define and consume them. `CredentialResult` fields match `types.ts`. DepositorAuth domain/types match `agents/compliance/src/signing/eip712.ts` (`StrataCompliance`/`1`/`5000`). ✓
