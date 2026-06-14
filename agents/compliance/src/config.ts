import { z } from 'zod';

const Env = z.object({
  MANTLE_RPC_URL: z.string().url(),
  MANTLE_RPC_URL_FALLBACK: z.string().url().default('https://mantle.publicgoods.network'),
  COMPLIANCE_PRIVATE_KEY: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  COMPLIANCE_DRY_RUN: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  COMPLIANCE_REGISTRY_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  JURISDICTION_POLICY_NFT_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  POLICY_REVOCATION_REGISTRY_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  LIGHTHOUSE_API_KEY: z.string().min(1),
  COMPLIANCE_HEALTH_PORT: z.coerce.number().int().min(1).max(65535).default(9094),
  COMPLIANCE_IDENTITY_NFT: z.string().default('ipfs://placeholder'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  CREDENTIAL_PROVIDER: z.enum(['stub', 'reclaim']).default('stub'),
  RECLAIM_APP_ID: z.string().optional(),
  RECLAIM_APP_SECRET: z.string().optional(),
  RECLAIM_PROVIDER_ID: z.string().optional(),
  RECLAIM_PROVIDER_VERSION: z.string().default('1.0.0'),
  RECLAIM_PROFILE: z.string().default('demo'),
  RECLAIM_PROOF_MAX_AGE_SEC: z.coerce.number().int().positive().default(900),
  RECLAIM_CALLBACK_BASE_URL: z.string().url().optional()
});

export function loadConfig() {
  const parsed = Env.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Config error: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`);
  }
  const env = parsed.data;
  if (!env.COMPLIANCE_DRY_RUN && !env.COMPLIANCE_REGISTRY_ADDRESS) {
    throw new Error('Config error: COMPLIANCE_REGISTRY_ADDRESS required when COMPLIANCE_DRY_RUN is not true');
  }
  if (!env.COMPLIANCE_DRY_RUN && !env.JURISDICTION_POLICY_NFT_ADDRESS) {
    throw new Error('Config error: JURISDICTION_POLICY_NFT_ADDRESS required when COMPLIANCE_DRY_RUN is not true');
  }
  if (!env.COMPLIANCE_DRY_RUN && !env.POLICY_REVOCATION_REGISTRY_ADDRESS) {
    throw new Error('Config error: POLICY_REVOCATION_REGISTRY_ADDRESS required when COMPLIANCE_DRY_RUN is not true');
  }
  if (env.CREDENTIAL_PROVIDER === 'reclaim') {
    const missing = (['RECLAIM_APP_ID', 'RECLAIM_APP_SECRET', 'RECLAIM_PROVIDER_ID'] as const)
      .filter((k) => !env[k]);
    if (missing.length > 0) {
      throw new Error(`Config error: ${missing.join(', ')} required when CREDENTIAL_PROVIDER=reclaim`);
    }
  }
  return {
    chain: { id: 5000, rpcUrl: env.MANTLE_RPC_URL, rpcFallback: env.MANTLE_RPC_URL_FALLBACK },
    compliance: {
      privateKey: env.COMPLIANCE_PRIVATE_KEY as `0x${string}`,
      dryRun: env.COMPLIANCE_DRY_RUN,
      healthPort: env.COMPLIANCE_HEALTH_PORT,
      identityNFT: env.COMPLIANCE_IDENTITY_NFT,
      registryAddress: (env.COMPLIANCE_REGISTRY_ADDRESS ?? '0x0000000000000000000000000000000000000000') as `0x${string}`,
      policyNftAddress: (env.JURISDICTION_POLICY_NFT_ADDRESS ?? '0x0000000000000000000000000000000000000000') as `0x${string}`,
      revocationRegistryAddress: (env.POLICY_REVOCATION_REGISTRY_ADDRESS ?? '0x0000000000000000000000000000000000000000') as `0x${string}`
    },
    ipfs: { lighthouseApiKey: env.LIGHTHOUSE_API_KEY },
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
    logLevel: env.LOG_LEVEL
  } as const;
}
export type ComplianceConfig = ReturnType<typeof loadConfig>;
