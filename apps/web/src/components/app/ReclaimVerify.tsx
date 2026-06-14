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
