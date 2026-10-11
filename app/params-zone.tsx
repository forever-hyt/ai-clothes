'use client';
// Zone 2 参数配置区：生成质量、预计消耗、可用余额与冻结中额度、
// 失败不收费说明、演示 Credits 免责声明，以及可折叠的演示流水（首次展开时拉取）。
// 成本数值全部来自 app/pricing.ts，与服务端扣费同源。
import type { CopyText } from './studio-copy';
import type { CreditsView, LedgerEntry } from './studio-types';
import { QUALITY_COST, QUALITIES, type Quality } from './pricing';

type Props = {
  t: CopyText;
  quality: Quality;
  onQualityChange: (quality: Quality) => void;
  credits: CreditsView | null;
  loggedIn: boolean;
  dbMode: boolean;
  ledger: LedgerEntry[] | null;
  ledgerLoading: boolean;
  onToggleLedger: (open: boolean) => void;
  busy: boolean;
};

const OP_LABEL = { freeze: 'ledgerOpFreeze', settle: 'ledgerOpSettle', release: 'ledgerOpRelease', restore: 'ledgerOpRestore' } as const;

export default function ParamsZone({ t, quality, onQualityChange, credits, loggedIn, dbMode, ledger, ledgerLoading, onToggleLedger, busy }: Props) {
  const cost = QUALITY_COST[quality];
  return <section className="zone-card" aria-label={t.zoneParams}>
    <div className="zone-head"><h3><span className="card-number">02</span>{t.zoneParams}</h3><span>{t.expectedCost.replace('{count}', String(cost))}</span></div>
    <p className="params-label">{t.qualityLabel}</p>
    <div className="quality-seg" role="group" aria-label={t.qualityLabel}>
      {QUALITIES.map(option => <button key={option} type="button" aria-pressed={quality === option} disabled={busy} onClick={() => onQualityChange(option)}>
        <strong>{option === 'hd' ? t.qualityHd : t.qualityStandard}</strong><small>{QUALITY_COST[option]} Credits</small>
      </button>)}
    </div>
    <div className="credits-row">
      {loggedIn ? credits ? <>
        <span className="credits-label">{t.availableBalance}</span>
        <span className="credit-chip"><strong>{credits.balance}</strong></span>
        <span className={`credit-chip ${credits.frozen > 0 ? 'frozen' : ''}`}><strong>{credits.frozen}</strong> {t.frozenBalance}</span>
      </> : <span className="credits-note">{t.creditsUnavailable}</span> : <span className="credits-note">{t.creditsLoginHint}</span>}
    </div>
    <p className="credits-note">{t.noChargeOnFailure}</p>
    <p className="credits-note">{dbMode ? t.dbCreditsNote : t.demoCredits}</p>
    <details className="ledger-details" onToggle={event => onToggleLedger((event.currentTarget as HTMLDetailsElement).open)}>
      <summary>{t.ledgerTitle}</summary>
      <div className="ledger-list" role="list">
        {ledgerLoading ? <p className="credits-note">{t.ledgerLoading}</p> : !ledger || ledger.length === 0 ? <p className="credits-note">{t.ledgerEmpty}</p> : ledger.map((entry, index) => {
          const refund = entry.op === 'release' || entry.op === 'restore';
          return <div className="ledger-entry" role="listitem" key={`${entry.at}-${entry.op}-${index}`}>
            <span>{t[OP_LABEL[entry.op]]}</span>
            <span className={refund ? 'plus' : 'minus'}>{refund ? '+' : '−'}{entry.amount}</span>
            <time dateTime={new Date(entry.at).toISOString()}>{new Date(entry.at).toLocaleTimeString()}</time>
          </div>;
        })}
      </div>
      <p className="credits-note">{t.ledgerNote}</p>
    </details>
  </section>;
}
