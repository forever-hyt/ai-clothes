'use client';
/* eslint-disable @next/next/no-img-element */
// Zone 1 图片上传区：示例素材、分类衣橱入口、人物/服装两个 dropzone（含格式尺寸提示）、
// 安全横幅与双重授权勾选。上传照片始终 fail-closed：仅本地预览，绝不发送到服务端。
import type { CopyKey, CopyText } from './studio-copy';
import type { Kind } from './studio-types';
import type { Material } from './studio-images';

type Props = {
  t: CopyText;
  materials: Record<Kind, Material | null>;
  reading: Record<Kind, boolean>;
  uploadErrors: Record<Kind, CopyKey | null>;
  consent: boolean;
  safetyConsent: boolean;
  busy: boolean;
  count: number;
  wardrobeOpen: boolean;
  onChoose: (kind: Kind, file?: File) => void;
  onRemove: (kind: Kind) => void;
  onUseSamples: () => void;
  onToggleClothes: () => void;
  onConsentChange: (checked: boolean) => void;
  onSafetyConsentChange: (checked: boolean) => void;
  onReadPrivacy: () => void;
};

export default function UploadZone(props: Props) {
  const { t, materials, reading, uploadErrors, consent, safetyConsent, busy, count, wardrobeOpen, onChoose, onRemove, onUseSamples, onToggleClothes, onConsentChange, onSafetyConsentChange, onReadPrivacy } = props;
  return <section className="zone-card" aria-label={t.zoneUpload}>
    <div className="zone-head"><h3><span className="card-number">01</span>{t.materials}</h3><span className="material-count">{count} / 2 {t.ready}</span></div>
    <div className="sample-row"><p>{t.sampleNote}</p><button type="button" className="secondary-button" disabled={busy} onClick={onUseSamples}>{t.samples} ↗</button></div>
    <button type="button" className="secondary-button clothing-open" aria-expanded={wardrobeOpen} aria-controls="clothing-library" onClick={onToggleClothes}>{t.browseWardrobe} ＋</button>
    <div className="uploads">
      {(['person', 'clothing'] as const).map(kind => {
        const material = materials[kind];
        return <article className={`upload-card ${kind}-card ${material ? 'has-image' : ''}`} key={kind}>
          <div className="card-heading"><h3>{t[kind]}</h3><span className="upload-badge">{reading[kind] ? t.reading : material ? `✓ ${t.uploaded}` : t.pending}</span></div>
          <label className="dropzone" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); onChoose(kind, event.dataTransfer.files[0]); }}>
            <input type="file" accept="image/jpeg,image/png,image/webp" aria-label={`${material ? t.replace : t.upload}: ${t[kind]}`} disabled={busy} onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; onChoose(kind, file); }} />
            {material ? <><img src={material.url} alt={t[kind]} /><span className="replace-hint">{t.replace}</span></> : <div className="upload-prompt"><span className="upload-icon" aria-hidden="true">{kind === 'person' ? '◎' : '♧'}</span><strong>{t[kind]}</strong><span>{t.drop}</span><span className="choose-file">{t.upload} ＋</span><small>{t.formats}</small></div>}
          </label>
          <div className="file-line"><span title={material?.name}>{material?.name || (kind === 'person' ? t.personHelp : t.clothingHelp)}</span>{material && <button type="button" disabled={busy} onClick={() => onRemove(kind)} aria-label={`${t.remove}: ${t[kind]}`}>{t.remove}</button>}</div>
          {uploadErrors[kind] && <p className="upload-error" role="alert">{t[uploadErrors[kind]]}</p>}
        </article>;
      })}
    </div>
    <aside className="safety-banner"><strong>{t.safetyTitle}</strong><p>{t.safetyText}</p><small>{t.localOnly}</small></aside>
    <div className="zone-consents">
      <label className="consent"><input type="checkbox" checked={consent} disabled={busy} onChange={event => onConsentChange(event.target.checked)} /><span>{t.consent}</span></label>
      <label className="consent safety-consent"><input type="checkbox" checked={safetyConsent} disabled={busy} onChange={event => onSafetyConsentChange(event.target.checked)} /><span>{t.safetyConsent}</span></label>
      <button type="button" className="text-button" onClick={onReadPrivacy}>{t.readPrivacy} ↗</button>
    </div>
  </section>;
}
