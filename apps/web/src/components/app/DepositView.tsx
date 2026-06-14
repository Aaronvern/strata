'use client';

// In-app Deposit view. Wallet not connected → "in beta · coming soon" panel.
// Wallet connected with no ComplianceRegistry receipt → same panel + a "not whitelisted"
// notice. Wallet connected with a receipt → minimal compliance-gated deposit form
// against the live ERC-4626 vaults on Mantle.

import { useAccount } from 'wagmi';
import { useComplianceReceipt } from '@/hooks/useComplianceReceipt';
import { DepositGate } from './DepositGate';
import { ReclaimVerify } from './ReclaimVerify';
import { isDemoDepositsEnabled } from '@/lib/demoDeposits';

const DEMO_WALLET = '0x000000000000000000000000000000000000dEaD' as const;

export function DepositView(_props: { initialTier?: string | null }) {
  const { address, isConnected } = useAccount();
  const { tokenId, loading, refetch } = useComplianceReceipt(isConnected ? address : undefined);
  const whitelisted = tokenId !== null && tokenId > 0n;
  const demoMode = isDemoDepositsEnabled();

  if (demoMode) {
    const wallet = (isConnected && address ? address : DEMO_WALLET) as `0x${string}`;
    return (
      <div className="app-content narrow">
        <div className="a-card" style={{ padding: '24px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ textAlign: 'center' }}>
            <span
              className="chip"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                padding: '6px 12px', borderRadius: 999,
                background: 'color-mix(in srgb, var(--accent) 14%, transparent)',
                border: '1px solid color-mix(in srgb, var(--accent) 40%, transparent)',
                color: 'var(--accent)', fontFamily: 'var(--mono)', fontSize: 11,
                letterSpacing: '.08em', textTransform: 'uppercase'
              }}
            >
              <span className="gdot" /> Demo mode · simulated deposit
            </span>
            <h2 style={{ margin: '12px 0 4px', fontSize: 20, fontWeight: 500 }}>Deposit USDC</h2>
            <p className="a-muted" style={{ maxWidth: 460, margin: '0 auto 14px', fontSize: 12.5, lineHeight: 1.55 }}>
              No wallet or USDC required. The form records a simulated deposit locally and pushes a synthetic
              entry into the activity feed.
            </p>
          </div>
          <DepositGate wallet={wallet} />
        </div>
      </div>
    );
  }

  if (isConnected && address && whitelisted) {
    return (
      <div className="app-content narrow">
        <div className="a-card" style={{ padding: '24px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ textAlign: 'center' }}>
            <span
              className="chip"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                padding: '6px 12px', borderRadius: 999,
                background: 'color-mix(in srgb, var(--green) 14%, transparent)',
                border: '1px solid color-mix(in srgb, var(--green) 40%, transparent)',
                color: 'var(--green)', fontFamily: 'var(--mono)', fontSize: 11,
                letterSpacing: '.08em', textTransform: 'uppercase'
              }}
            >
              <span className="gdot" /> Receipt #{tokenId.toString()} · whitelisted
            </span>
            <h2 style={{ margin: '12px 0 4px', fontSize: 20, fontWeight: 500 }}>Deposit USDC</h2>
            <p className="a-muted" style={{ maxWidth: 460, margin: '0 auto 14px', fontSize: 12.5, lineHeight: 1.55 }}>
              Wallet {address.slice(0, 6)}…{address.slice(-4)} carries a soulbound Compliance Receipt. Pick a tranche and deposit.
            </p>
          </div>
          <DepositGate wallet={address} />
        </div>
      </div>
    );
  }

  return (
    <div className="app-content narrow">
      <div
        className="a-card"
        style={{
          padding: '36px 28px',
          textAlign: 'center',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 14
        }}
      >
        <span
          className="chip"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '6px 12px', borderRadius: 999,
            background: 'color-mix(in srgb, var(--accent) 14%, transparent)',
            border: '1px solid color-mix(in srgb, var(--accent) 40%, transparent)',
            color: 'var(--accent)', fontFamily: 'var(--mono)', fontSize: 11,
            letterSpacing: '.08em', textTransform: 'uppercase'
          }}
        >
          <span className="gdot" /> In beta · coming soon
        </span>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 500, letterSpacing: '-.015em' }}>
          Deposits are in private beta
        </h2>
        <p className="a-muted" style={{ maxWidth: 460, lineHeight: 1.55, margin: 0 }}>
          The compliance flow and the on-chain deposit path are wired end-to-end but gated for the
          public preview. Watch the dashboard for live agent activity meanwhile.
        </p>
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
        <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 10, flexWrap: 'wrap' }}>
          <a href="/app" className="btn-app btn-primary">
            View live dashboard
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path d="M2 6h8M7 3l3 3-3 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </a>
          <a href="/" className="btn-app btn-ghost">Back to landing</a>
        </div>
        <p className="a-muted mono" style={{ fontSize: 11, marginTop: 8 }}>
          {isConnected
            ? 'Connected wallet is on the waitlist.'
            : 'You can still connect a wallet from the topbar to join the waitlist.'}
        </p>
      </div>
    </div>
  );
}
