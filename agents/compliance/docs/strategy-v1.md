# Compliance Strategy, v1

Compliance is the deposit-gate agent for Strata. This document is signed and pinned to IPFS, and the CID is recorded on Compliance's ERC-8004 identity NFT.

## Identity

- On-chain agent address: set at deployment, recorded on the ERC-8004 identity token.
- Strategy CID is updated through `IERC8004Identity.updateStrategyCid(tokenId, newCid)` when this document changes.
- Event bus contract: `AgentEventBus`, deployed on Mantle (chain id 5000). Compliance is granted `Role.Compliance` by the bus owner.

## What Compliance does

Compliance runs two separate processes. The deposit gate and the policy publisher are separate binaries with separate concerns.

**Deposit gate.** On each `POST /api/v1/compliance/check`, the gate verifies the depositor's credential, screens them against the sanctions oracle, resolves the jurisdiction policy on-chain, routes the depositor to permitted tranches, encrypts the evidence, signs an EIP-712 receipt, pins it to Lighthouse, and mints a `ComplianceReceipt` NFT on the `ComplianceRegistry`. The gate is fully deterministic. It never imports AI, never calls an LLM, and never makes a judgment call. Every path either produces a signed receipt or returns a typed denial.

**Policy publisher.** A separate binary that manages jurisdiction policy NFTs on the `JurisdictionPolicyNFT` contract. In v2 this will include an AI policy interpreter that reads regulatory source text and proposes tranche-permission tables for multisig approval.

## Perpendicular to the rebalance loop

Compliance does not subscribe to `AllocationProposed` or any rebalance event. The gate runs on depositor demand, not on Architect's cycle. A valid receipt is a prerequisite for the vault's deposit function. The rebalance agents (Architect, Sentinel, Operator) never call or depend on Compliance at runtime.

## v1 scope

- Stub credential adapter (EIP-712 signed test credentials from Hardhat account #0)
- Stub sanctions oracle (hardcoded denylist, two addresses)
- 4 jurisdiction policies: US, EU, GB, permissionless (stub, in-memory)
- EIP-712 signing for DepositorAuth and ComplianceReceipt
- AES-256-GCM evidence encryption with per-receipt keys
- Deterministic tranche routing from policy lookup table
- HTTP API with Fastify, rate-limited, CORS-enabled

## v2 scope

- Real credential adapters: Reclaim Protocol shipped (see reclaim-adapter.md); zkPass / Privado ID optional
- Real sanctions oracle (Chainalysis)
- Safe multisig for policy publishing with quorum signatures
- AI policy interpreter (reads regulatory text, proposes permission tables, humans approve)
- On-chain identity gate via `IDENTITY_REGISTRY_ADDRESS`
