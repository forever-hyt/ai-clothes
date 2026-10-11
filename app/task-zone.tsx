'use client';
// Zone 3 生成任务区：四段进度（已提交→排队中→生成中→完成/失败）、提交按钮与预计消耗、
// 冻结提示、失败告警（原因+建议+重试+改用本地预览）、模拟失败演示开关、幂等键展示、
// 活动期取消按钮。提交区保留 .action class 维持移动端 sticky。
import type { CopyKey, CopyText } from './studio-copy';
import type { ServerTask, TaskPhase } from './studio-types';

type Notice = { key: CopyKey; error?: boolean; count?: number };

type Props = {
  t: CopyText;
  phase: TaskPhase;
  task: ServerTask | null;
  idempotencyKey: string | null;
  cost: number;
  simulateFailure: boolean;
  onSimulateFailureChange: (value: boolean) => void;
  busy: boolean;
  cancelBusy: boolean;
  frozenAmount: number;
  notice: Notice;
  loggedIn: boolean;
  creditsBalance: number | null;
  canSubmit: boolean;
  primaryLabel: string;
  onSubmit: () => void;
  onRetry: () => void;
  onCancelTask: () => void;
  onUseLocalPreview: () => void;
  onResumeCheck: () => void;
};

// 进度阶段下标：submitting=0，queued=1，processing=2，终态=3；idle/resuming 无高亮。
function stageFor(phase: TaskPhase): number {
  if (phase === 'submitting') return 0;
  if (phase === 'queued') return 1;
  if (phase === 'processing') return 2;
  if (phase === 'succeeded' || phase === 'failed' || phase === 'cancelled') return 3;
  return -1;
}

export default function TaskZone(props: Props) {
  const { t, phase, task, idempotencyKey, cost, simulateFailure, onSimulateFailureChange, busy, cancelBusy, frozenAmount, notice, loggedIn, creditsBalance, canSubmit, primaryLabel, onSubmit, onRetry, onCancelTask, onUseLocalPreview, onResumeCheck } = props;
  const stage = stageFor(phase);
  const terminal = phase === 'succeeded' || phase === 'failed' || phase === 'cancelled';
  const doneLabel = terminal && phase !== 'succeeded' ? t.progressFailed : t.progressDone;
  const failureText = task?.failure?.code === 'SIMULATED_PROVIDER_ERROR' ? t.failureSimulated : task?.failure?.code === 'TIMEOUT' ? t.failureTimeout : t.failureProvider;
  return <section className="zone-card" aria-label={t.zoneTask}>
    <div className="zone-head"><h3><span className="card-number">03</span>{t.zoneTask}</h3>{frozenAmount > 0 && <span className="credit-chip frozen"><strong>{frozenAmount}</strong> {t.frozenBalance}</span>}</div>
    <ol className="task-progress">
      {[t.progressSubmitted, t.progressQueued, t.progressGenerating, doneLabel].map((label, index) => {
        const failed = terminal && phase !== 'succeeded' && index === 3;
        return <li key={label} className={stage >= 0 && index < stage ? 'done' : index === stage && !terminal ? 'active' : failed ? 'failed' : ''}>
          <span className="stage-dot" aria-hidden="true">{index + 1}</span><strong>{label}</strong>
        </li>;
      })}
    </ol>
    {phase === 'failed' && task?.failure && <div className="failure-alert" role="alert">
      <strong>{t.failureTitle}</strong>
      <p>{failureText}</p>
      <p className="failure-tip">{t.failureTip}</p>
      <div className="failure-actions">
        <button type="button" className="primary" disabled={busy} onClick={onRetry}>{t.retryButton}</button>
        <button type="button" className="secondary-button" disabled={busy} onClick={onUseLocalPreview}>{t.useLocalPreview}</button>
      </div>
    </div>}
    {(phase === 'queued' || phase === 'processing') && <>
      <p className="frozen-notice">{t.frozenNotice.replace('{count}', String(frozenAmount))}</p>
      <button type="button" className="secondary-button cancel-task" disabled={cancelBusy} aria-busy={cancelBusy} onClick={onCancelTask}>{t.cancelTask}</button>
    </>}
    <label className="demo-toggle">
      <input type="checkbox" checked={simulateFailure} disabled={busy} onChange={event => onSimulateFailureChange(event.target.checked)} />
      <span>{t.simulateFailureLabel}</span>
    </label>
    {idempotencyKey && <p className="idempotency-key"><span>{t.idempotencyLabel}：</span><code title={idempotencyKey}>{idempotencyKey}</code><small>{t.idempotencyHelp}</small></p>}
    <div className="action">
      <button type="button" className={`primary ${busy ? 'loading' : ''}`} disabled={!canSubmit} aria-busy={busy} onClick={onSubmit}>{primaryLabel}</button>
      {loggedIn && <p className="credits-note submit-note">{t.serverSubmitNote}</p>}
      {loggedIn && creditsBalance !== null && creditsBalance < cost && !busy && <p role="alert" className="error">{t.insufficientCredits}</p>}
      <p role={notice.error ? 'alert' : 'status'} aria-live={notice.error ? 'assertive' : 'polite'} className={notice.error ? 'error' : ''}>{t[notice.key].replace('{count}', String(notice.count ?? ''))}</p>
      {notice.key === 'resumeChecking' && <button type="button" className="secondary-button" onClick={onResumeCheck}>{t.retryButton}</button>}
    </div>
    <details className="server-demo"><summary>{t.serverPreview}</summary><p>{t.serverHelp}</p><button type="button" className="secondary-button" disabled>{t.tryOnUnavailable}</button></details>
  </section>;
}
