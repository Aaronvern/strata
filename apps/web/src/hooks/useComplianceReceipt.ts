'use client';

import { useReadContract } from 'wagmi';

const COMPLIANCE_REGISTRY = '0x0481bE75687b3d4daAc6fc0ED2c3b51DC85E7550' as const;

const REGISTRY_ABI = [
  {
    type: 'function',
    name: 'receiptOf',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }]
  }
] as const;

// receiptOf returns the user's soulbound receipt tokenId (0 = no receipt). We
// picked receiptOf over isAllowed because the spec wants a single yes/no for
// "is this wallet whitelisted at all" rather than per-tranche permission; the
// deposit form lets the user pick their tranche, so we'd otherwise need three
// isAllowed calls. receiptOf is one read.
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
