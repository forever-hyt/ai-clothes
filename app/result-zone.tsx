'use client';
/* eslint-disable @next/next/no-img-element */
// Zone 4 生成结果区：搭配板/人物原图切换、下载（服务端结果走 ?download=1 由
// Content-Disposition 触发，原图与本地结果沿用 data URL）、保存作品（服务端内存标记
// + 已保存徽章）、重新生成。服务端结果显示“演示生成 · 非真实 AI 结果”。
import { useState, type RefObject } from 'react';
import type { CopyText } from './studio-copy';
import type { ServerTask, StudioResult } from './studio-types';

type Props = {
  t: CopyText;
  result: StudioResult | null;
  resultView: 'board' | 'original';
  onViewChange: (view: 'board' | 'original') => void;
  busy: boolean;
  task: ServerTask | null;
  saving: boolean;
  onSave: () => void;
  onRegenerate: () => void;
  headingRef: RefObject<HTMLHeadingElement | null>;
};

export default function ResultZone({ t, result, resultView, onViewChange, busy, task, saving, onSave, onRegenerate, headingRef }: Props) {
  // 只针对当前服务端结果的过期标记：结果更换后自动失效，无需 effect 复位。
  const [goneBoard, setGoneBoard] = useState<string | null>(null);
  const server = Boolean(result?.server);
  const serverBoard = server && resultView === 'board';
  const gone = serverBoard && result?.board === goneBoard;
  const saved = server && task?.state === 'succeeded' && task.saved;
  return <section className="zone-card" aria-busy={busy} aria-label={t.zoneResult}>
    <div className="zone-head result-heading">
      <div><span className="tiny-label">YOUR PREVIEW</span><h2 ref={headingRef} tabIndex={-1}>{t.result}</h2></div>
      <span>{busy ? t.preparing : result ? server ? t.resultPill : t.demo : t.pending}</span>
    </div>
    {result && !gone ? <>
      <div className="result-switch" aria-label={t.result}>
        <button type="button" aria-pressed={resultView === 'board'} onClick={() => onViewChange('board')}>{t.board}</button>
        <button type="button" aria-pressed={resultView === 'original'} onClick={() => onViewChange('original')}>{t.original}</button>
      </div>
      <div id="result-output">
        <p className="result-note">{resultView === 'board' ? t.resultNote : t.originalNote}</p>
        <img id="result-image" src={result[resultView]} alt={resultView === 'board' ? t.board : t.original} onError={serverBoard ? () => setGoneBoard(result.board) : undefined} />
        {serverBoard
          ? <a id="download-result" href={`${result.board}?download=1`}>{t.download} ↓</a>
          : <a id="download-result" href={result[resultView]} download={resultView === 'board' ? 'style-muse-board.png' : server ? 'style-muse-portrait.webp' : 'style-muse-portrait.png'}>{t.download} ↓</a>}
      </div>
      <div className="result-actions">
        {server && task && task.state === 'succeeded' && (saved
          ? <span className="saved-badge">✓ {t.savedBadge}</span>
          : <button type="button" className="secondary-button" disabled={saving} aria-busy={saving} onClick={onSave}>{t.saveWork}</button>)}
        <button type="button" className="secondary-button" disabled={busy} onClick={onRegenerate}>{t.regenerate}</button>
      </div>
      {saved && <p className="save-note">{t.saveNote}</p>}
    </> : !gone ? <div className="empty"><div className="result-frame"><span>✧</span></div><h3>{t.empty}</h3><p>{t.emptyHelp}</p><span className="preview-label">{t.demo}</span></div> : null}
    {gone && <div className="result-gone" role="alert">{t.resultGone}<button type="button" className="text-button" onClick={onRegenerate}>{t.retryButton}</button></div>}
    <p className="result-footnote">{t.resultNote}</p>
  </section>;
}
