import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import pino from 'pino';
import { loadConfig } from './config.js';
import { buildChainClients } from './chain/client.js';
import { createStubCredentialAdapter } from './adapters/stubCredential.js';
import { createStubSanctionsOracle } from './adapters/stubSanctions.js';
import { createReclaimCredentialAdapter } from './adapters/reclaimCredential.js';
import { getProfile } from './adapters/reclaimProfiles.js';
import { createStubPolicyResolver, createLivePolicyResolver } from './pipeline/policyResolver.js';
import { GateOrchestrator } from './pipeline/gateOrchestrator.js';
import { makePublisher } from './publication/publish.js';
import { readActiveReceipt } from './chain/onchain.js';
import { pinJsonToLighthouse } from '@strata/scout/ipfs';
import { makeHealth } from './monitor/health.js';
import { makeMetrics } from './monitor/metrics.js';
import { buildServer } from './api/server.js';
import type { PublicClient } from 'viem';

async function main(): Promise<void> {
  const cfg = loadConfig();
  const log = pino({ level: cfg.logLevel });
  log.info('compliance gate starting');

  const clients = buildChainClients({
    rpcUrl: cfg.chain.rpcUrl,
    rpcFallback: cfg.chain.rpcFallback,
    privateKey: cfg.compliance.privateKey
  });
  const publicClient = clients.publicClient as unknown as PublicClient;

  let methodologyHash: string;
  try {
    const methodologyText = readFileSync('agents/compliance/docs/compliance-methodology.md', 'utf-8');
    methodologyHash = '0x' + createHash('sha256').update(methodologyText).digest('hex');
  } catch {
    methodologyHash = '0x' + '00'.repeat(32);
  }

  let codeCommit: string;
  try {
    codeCommit = execSync('git rev-parse HEAD').toString().trim();
  } catch {
    codeCommit = 'unknown';
  }

  const health = makeHealth();
  const metrics = makeMetrics();

  const credentialAdapter =
    cfg.credential.provider === 'reclaim'
      ? createReclaimCredentialAdapter({
          providerId: cfg.credential.reclaim.providerId,
          providerVersion: cfg.credential.reclaim.providerVersion,
          profile: getProfile(cfg.credential.reclaim.profile),
          maxAgeSec: cfg.credential.reclaim.proofMaxAgeSec
        })
      : createStubCredentialAdapter();
  const sanctionsOracle = createStubSanctionsOracle();
  const policyResolver = cfg.compliance.dryRun
    ? createStubPolicyResolver()
    : createLivePolicyResolver({
        publicClient,
        policyNftAddress: cfg.compliance.policyNftAddress,
        revocationRegistryAddress: cfg.compliance.revocationRegistryAddress
      });

  const publisher = makePublisher({
    wallet: clients.walletClient,
    publicClient,
    account: clients.account,
    registryAddress: cfg.compliance.registryAddress,
    lighthouseApiKey: cfg.ipfs.lighthouseApiKey,
    dryRun: cfg.compliance.dryRun
  });

  const orchestrator = new GateOrchestrator({
    credentialAdapter,
    sanctionsOracle,
    policyResolver,
    publisher,
    pinEvidence: (data, apiKey) => pinJsonToLighthouse(data, apiKey),
    lighthouseApiKey: cfg.ipfs.lighthouseApiKey,
    publisherAddress: clients.account.address,
    identityNFT: cfg.compliance.identityNFT,
    methodologyHash,
    codeCommit,
    ...(cfg.compliance.dryRun ? {} : {
      readActiveReceipt: (wallet: `0x${string}`) => readActiveReceipt({
        publicClient,
        registryAddress: cfg.compliance.registryAddress,
        wallet
      })
    })
  });

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
      req.setContext(wallet, 'Strata deposit compliance');
      if (cfg.credential.reclaim.callbackBaseUrl) {
        req.setAppCallbackUrl(
          `${cfg.credential.reclaim.callbackBaseUrl}/api/v1/compliance/reclaim/callback`,
          true
        );
      }
      return req.toJsonString();
    };
  }

  const server = await buildServer({
    orchestrator,
    health,
    metrics,
    ...(reclaimConfigProvider ? { reclaimConfigProvider } : {})
  });

  const shutdown = async () => {
    log.info('shutting down');
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await server.listen({ port: cfg.compliance.healthPort, host: '0.0.0.0' });
  log.info({ port: cfg.compliance.healthPort }, 'compliance gate listening');
}

main().catch((e) => { console.error(e); process.exit(1); });
