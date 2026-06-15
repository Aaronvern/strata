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

Two layers: the proof's `context.contextAddress` (set server-side at request
init via `ReclaimProofRequest.setContext(wallet, …)`) must equal the depositor
wallet, and the user signs a `DepositorAuth` EIP-712 over the proof identifier.
`credentialEvidenceHash` is the proof's signed `identifier`.

## Go-live gates (still stubbed)

Real sanctions oracle, KMS key custody, real jurisdiction policies, a paid
Reclaim plan, and the legal layer. See the design spec §11.

Also set `RECLAIM_PROFILE=exchange-kyc` in production. The default `demo`
profile maps any verified, wallet-bound proof to `basic`/`permissionless`
regardless of the holder's real KYC status — it exists only to exercise the
full pipeline without an exchange account, and is fail-open on the KYC-tier
mapping. Wallet binding, signature, and freshness checks still apply under
`demo`; the tier mapping does not.
