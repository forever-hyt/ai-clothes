'use client';
/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { copy, type CopyKey, type Language } from './studio-copy';
import { makePreviews, readMaterial, sampleMaterials, type Material } from './studio-images';

type View = 'studio' | 'privacy' | 'terms';
type Kind = 'person' | 'clothing';
type User = { username: string };
type Notice = { key: CopyKey; error?: boolean; count?: number };
const errorKeys: Record<string, CopyKey> = {
  AUTH_UNAVAILABLE: 'unavailable', AUTH_REQUIRED: 'authNeeded', INVALID_CREDENTIALS: 'wrongPassword',
  INVALID_ORIGIN: 'invalidOrigin', RATE_LIMITED: 'rateLimited', INVALID_IMAGE: 'invalid', INVALID_REQUEST: 'invalidRequest',
  CONSENT_REQUIRED: 'needConsent', QUOTA_EXCEEDED: 'quota', PROCESSING: 'serverBusy',
};
async function request(url: string, body?: unknown) {
  let response: Response;
  try { response = await fetch(url, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000) }); }
  catch (error) { throw new Error(error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'networkError'); }
  let data;
  try { data = await response.json(); } catch { throw new Error('networkError'); }
  if (!response.ok) throw new Error(errorKeys[data.code] || (response.status === 401 ? 'authNeeded' : response.status === 429 ? 'rateLimited' : 'invalidRequest'));
  return data;
}
function errorKey(error: unknown): CopyKey {
  return error instanceof Error && error.message in copy.zh ? error.message as CopyKey : 'exportError';
}

export default function Studio({ initialView = 'studio', contact = '' }: { initialView?: View; contact?: string }) {
  const [language, setLanguage] = useState<Language>('zh');
  const [languageReady, setLanguageReady] = useState(false);
  const [view, setView] = useState<View>(initialView);
  const [materials, setMaterials] = useState<Record<Kind, Material | null>>({ person: null, clothing: null });
  const [reading, setReading] = useState<Record<Kind, boolean>>({ person: false, clothing: false });
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ board: string; original: string; server?: boolean } | null>(null);
  const [resultView, setResultView] = useState<'board' | 'original'>('board');
  const [notice, setNotice] = useState<Notice>({ key: 'initial' });
  const [user, setUser] = useState<User | null>(null);
  const [auth, setAuth] = useState<'checking' | 'ready' | 'unavailable' | 'unknown'>('checking');
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState<CopyKey | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const loginButton = useRef<HTMLButtonElement>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const versions = useRef({ person: 0, clothing: 0 });
  const busyRef = useRef(false);
  const authVersion = useRef(0);
  const loginBusyRef = useRef(false);
  const t = copy[language];
  const count = Number(Boolean(materials.person)) + Number(Boolean(materials.clothing));
  const isReading = reading.person || reading.clothing;
  const canProcess = !busy && !isReading && count === 2 && consent;
  const primaryLabel = busy ? t.preparing : isReading ? t.reading : !materials.person ? t.needPerson : !materials.clothing ? t.needClothing : !consent ? t.needConsent : t.preview;

  async function checkAccount() {
    const version = ++authVersion.current; setAuth('checking');
    try { const data = await request('/api/auth/me'); if (version !== authVersion.current) return; setUser(data.user); setAuth(data.loginAvailable ? 'ready' : 'unavailable'); }
    catch { if (version === authVersion.current) setAuth('unknown'); }
  }
  useEffect(() => {
    const pendingVersions = versions.current;
    const pendingAuth = authVersion;
    const frame = requestAnimationFrame(() => {
      try { const saved = localStorage.getItem('style-muse-language'); if (saved === 'en' || saved === 'zh') setLanguage(saved); else if (!navigator.language.toLowerCase().startsWith('zh')) setLanguage('en'); } catch { /* Optional preference storage. */ }
      setLanguageReady(true); void checkAccount();
    });
    const handleBack = () => {
      const query = new URLSearchParams(window.location.search).get('view');
      setView(query === 'privacy' || query === 'terms' ? query : window.location.pathname === '/privacy' ? 'privacy' : window.location.pathname === '/terms' ? 'terms' : 'studio');
    };
    window.addEventListener('popstate', handleBack);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('popstate', handleBack); pendingVersions.person++; pendingVersions.clothing++; pendingAuth.current++; };
  }, []);
  useEffect(() => {
    if (!languageReady) return;
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
    document.title = language === 'zh' ? '衣搭灵感 · AI 穿搭与虚拟试衣' : 'Style Muse · AI styling & virtual try-on';
    try { localStorage.setItem('style-muse-language', language); } catch { /* Optional preference storage. */ }
  }, [language, languageReady]);
  useEffect(() => {
    const timer = setInterval(() => { if (!busyRef.current) { versions.current.person++; versions.current.clothing++; setMaterials({ person: null, clothing: null }); setReading({ person: false, clothing: false }); setResult(null); setConsent(false); setNotice({ key: 'expired' }); } }, 30 * 60 * 1000);
    return () => clearInterval(timer);
  }, []);
  function switchView(next: View) {
    setView(next); const url = new URL(window.location.href); url.pathname = '/'; url.searchParams.set('view', next); url.hash = '';
    window.history.pushState(null, '', url); window.scrollTo({ top: 0, behavior: 'instant' });
  }
  function clear() {
    if (busyRef.current) return;
    versions.current.person++; versions.current.clothing++; setMaterials({ person: null, clothing: null }); setReading({ person: false, clothing: false }); setResult(null); setConsent(false); setNotice({ key: 'cleared' });
  }
  function remove(kind: Kind) {
    if (busyRef.current) return;
    versions.current[kind]++; setReading(old => ({ ...old, [kind]: false })); setMaterials(old => ({ ...old, [kind]: null })); setResult(null); setNotice({ key: 'initial' });
  }
  async function choose(kind: Kind, file?: File) {
    if (!file || busyRef.current) return;
    const version = ++versions.current[kind]; setReading(old => ({ ...old, [kind]: true }));
    try { const material = await readMaterial(file); if (versions.current[kind] !== version) return; setMaterials(old => ({ ...old, [kind]: material })); setResult(null); setNotice({ key: 'selected' }); }
    catch (error) { if (versions.current[kind] === version) setNotice({ key: errorKey(error), error: true }); }
    finally { if (versions.current[kind] === version) setReading(old => ({ ...old, [kind]: false })); }
  }
  function useSamples() {
    if (busyRef.current) return;
    versions.current.person++; versions.current.clothing++; setReading({ person: false, clothing: false }); setMaterials(sampleMaterials()); setResult(null); setConsent(false); setNotice({ key: 'selected' });
  }
  function openLogin() { setLoginError(null); setShowPassword(false); dialog.current?.showModal(); }
  async function process(server = false) {
    if (!canProcess || busyRef.current || !materials.person || !materials.clothing) return;
    if (server && !user) { openLogin(); return; }
    busyRef.current = true; setBusy(true); setNotice({ key: 'preparing' });
    try {
      let next = await makePreviews(materials.person.url, materials.clothing.url);
      if (server) {
        const payload = materials.person.url.startsWith('data:image/svg') || materials.clothing.url.startsWith('data:image/svg') ? await rasterMaterials(materials.person.url, materials.clothing.url) : { personImage: materials.person.url, clothingImage: materials.clothing.url };
        const data = await request('/api/try-on', { ...payload, privacyConsent: consent });
        next = { ...next, original: data.resultUrl }; setNotice({ key: 'serverDone', count: data.remaining });
      } else setNotice({ key: 'localDone' });
      setResult({ ...next, server }); setResultView(server ? 'original' : 'board');
      setTimeout(() => resultHeading.current?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }), 50);
    } catch (error) { const key = errorKey(error); if (key === 'authNeeded') { setUser(null); openLogin(); } setNotice({ key, error: true }); }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (loginBusyRef.current || auth !== 'ready') return;
    const form = event.currentTarget; const fields = new FormData(form); loginBusyRef.current = true; setLoginBusy(true); setLoginError(null); authVersion.current++;
    try {
      await request('/api/auth/login', { username: String(fields.get('username')).trim(), password: fields.get('password') });
      const session = await request('/api/auth/me'); if (!session.user) throw new Error('cookieError');
      setUser(session.user); setAuth('ready'); dialog.current?.close(); form.reset(); setNotice({ key: 'loggedIn' }); loginButton.current?.focus();
    } catch (error) { setLoginError(errorKey(error)); if (errorKey(error) === 'unavailable') setAuth('unavailable'); }
    finally { loginBusyRef.current = false; setLoginBusy(false); }
  }
  async function signOut() {
    if (loginBusyRef.current || busyRef.current) return; loginBusyRef.current = true; setLoginBusy(true); authVersion.current++;
    try { await request('/api/auth/logout', {}); setUser(null); setNotice({ key: 'signedOut' }); }
    catch (error) { setNotice({ key: errorKey(error), error: true }); }
    finally { loginBusyRef.current = false; setLoginBusy(false); }
  }
  function renderUpload(kind: Kind) {
    const material = materials[kind];
    return <article className={`upload-card ${kind}-card ${material ? 'has-image' : ''}`} key={kind}>
      <div className="card-heading"><h3><span className="card-number">{kind === 'person' ? '01' : '02'}</span>{t[kind]}</h3><span className="upload-badge">{reading[kind] ? t.reading : material ? `✓ ${t.uploaded}` : t.pending}</span></div>
      <label className="dropzone" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); void choose(kind, event.dataTransfer.files[0]); }}>
        <input type="file" accept="image/jpeg,image/png,image/webp" aria-label={`${material ? t.replace : t.upload}: ${t[kind]}`} disabled={busy} onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; void choose(kind, file); }} />
        {material ? <><img src={material.url} alt={t[kind]} /><span className="replace-hint">{t.replace}</span></> : <div className="upload-prompt"><span className="upload-icon" aria-hidden="true">{kind === 'person' ? '◎' : '♧'}</span><strong>{t[kind]}</strong><span>{t.drop}</span><span className="choose-file">{t.upload} ＋</span><small>{t.formats}</small></div>}
      </label><div className="file-line"><span title={material?.name}>{material?.name || (kind === 'person' ? t.personHelp : t.clothingHelp)}</span>{material && <button type="button" disabled={busy} onClick={() => remove(kind)} aria-label={`${t.remove}: ${t[kind]}`}>{t.remove}</button>}</div>
    </article>;
  }
  const policy = <section className="policy-panel" aria-labelledby="policy-heading"><span className="tiny-label">STYLE MUSE / TRUST</span><h1 id="policy-heading">{view === 'terms' ? t.termsTitle : t.privacyTitle}</h1><p className="policy-intro">{view === 'terms' ? t.termsText : t.privacyIntro}</p><p className="policy-date">{t.updated}</p>{view === 'terms' ? <p>{t.limits}</p> : <><div className="policy-grid">{(['Local', 'Server', 'Delete', 'Account'] as const).map(key => <article key={key}><h2>{t[`privacy${key}`]}</h2><p>{t[`privacy${key}Text`]}</p></article>)}</div><h2>{t.contact}</h2><p>{contact || t.noContact}</p></>}<button className="primary policy-back" onClick={() => switchView('studio')}>{t.back} →</button></section>;
  return <>
    <header className="nav studio-nav"><button className="brand brand-button" onClick={() => switchView('studio')} aria-label={t.brand}><span className="logo">✦</span><strong>{t.brand} <span>AI</span></strong></button>
      <nav className="view-switch" aria-label={language === 'zh' ? '主导航' : 'Main navigation'}><button type="button" aria-pressed={view === 'studio'} onClick={() => switchView('studio')}>{t.studio}</button><button type="button" aria-pressed={view === 'privacy'} onClick={() => switchView('privacy')}>{t.privacy}</button></nav>
      <div className="header-controls"><label className="language-control"><span aria-hidden="true">◎</span><select aria-label={t.language} value={language} onChange={event => setLanguage(event.target.value as Language)}><option value="zh">简体中文</option><option value="en">English</option></select></label><button ref={loginButton} type="button" className="sign-in-button" disabled={loginBusy || busy} onClick={() => user ? void signOut() : openLogin()}>{user ? t.logout : t.login}</button></div>
    </header>
    <main className="studio-main"><div hidden={view !== 'studio'}>
      <section className="hero"><div className="hero-copy"><span className="eyebrow"><span className="dot" />{t.eyebrow}</span><h1>{t.heading}<br /><em>{t.accent}</em></h1><p>{t.intro}</p><div className="hero-chips"><span>◇ {t.localChip}</span><span>↗ {t.exportChip}</span></div></div><div className="hero-art new-hero-art" aria-hidden="true"><div className="art-card art-person"><span>THE MUSE</span><img src={sampleMaterials().person.url} alt="" /></div><div className="art-card art-clothing"><span>THE LOOK</span><img src={sampleMaterials().clothing.url} alt="" /></div><div className="art-spark">✦</div></div></section>
      <section className="studio-section"><div className="studio-toolbar"><div><span className="tiny-label">CREATE YOUR NEXT LOOK</span><h2>{t.title} <span className="demo-tag">{t.demo}</span></h2></div><span className="toolbar-note">{t.demoNote}</span></div>
        <ol className="steps">{[t.step1, t.step2, t.step3].map((label, index) => { const active = result ? 2 : count === 2 ? 1 : 0; return <li key={index} className={index === active ? 'active' : index < active ? 'done' : ''} aria-current={index === active ? 'step' : undefined}><span>0{index + 1}</span><strong>{label}</strong></li>; })}</ol>
        <div className="studio-grid"><section className="workspace"><div className="workspace-head"><div><span className="tiny-label">YOUR MATERIALS</span><h2>{t.materials}</h2></div><span className="material-count">{count} / 2 {t.ready}</span></div>
          <div className="sample-row"><p>{t.sampleNote}</p><button type="button" className="secondary-button" disabled={busy} onClick={useSamples}>{t.samples} ↗</button></div><div className="uploads">{renderUpload('person')}{renderUpload('clothing')}</div>
          <div className="action"><label className="consent"><input type="checkbox" checked={consent} disabled={busy} onChange={event => setConsent(event.target.checked)} /><span>{t.consent}</span></label><button type="button" className="text-button" onClick={() => switchView('privacy')}>{t.readPrivacy} ↗</button><button type="button" className={`primary ${busy ? 'loading' : ''}`} disabled={!canProcess} aria-busy={busy} onClick={() => void process()}>{primaryLabel}</button><p role="status" aria-live="polite" className={notice.error ? 'error' : ''}>{t[notice.key].replace('{count}', String(notice.count ?? ''))}</p></div>
          <details className="server-demo"><summary>{t.serverPreview}</summary><p>{t.serverHelp}</p>{auth !== 'ready' && <p>{t[auth]}</p>}<button type="button" className="secondary-button" disabled={!canProcess || auth !== 'ready'} onClick={() => void process(true)}>{user ? t.serverPreview : t.login}</button></details>
        </section><section className="results" aria-busy={busy}><div className="result-heading"><div><span className="tiny-label">YOUR PREVIEW</span><h2 ref={resultHeading} tabIndex={-1}>{t.result}</h2></div><span>{busy ? t.preparing : result ? t.demo : t.pending}</span></div>
          {result ? <><div className="result-switch" aria-label={t.result}><button aria-pressed={resultView === 'board'} onClick={() => setResultView('board')}>{t.board}</button><button aria-pressed={resultView === 'original'} onClick={() => setResultView('original')}>{t.original}</button></div><div id="result-output"><p className="result-note">{resultView === 'board' ? t.resultNote : t.originalNote}</p><img id="result-image" src={result[resultView]} alt={resultView === 'board' ? t.board : t.original} /><a id="download-result" href={result[resultView]} download={resultView === 'board' ? 'style-muse-board.png' : result.server ? 'style-muse-portrait.webp' : 'style-muse-portrait.png'}>{t.download} ↓</a></div></> : <div className="empty"><div className="result-frame"><span>✧</span></div><h3>{t.empty}</h3><p>{t.emptyHelp}</p><span className="preview-label">{t.demo}</span></div>}<p className="result-footnote">{t.resultNote}</p>
        </section></div>
      </section><aside className="privacy-bar"><div className="privacy-copy"><span className="privacy-icon" aria-hidden="true">◇</span><div><strong>{t.privacyTitle}</strong><p>{t.clearHelp}</p></div></div><button type="button" id="clear-images" disabled={busy || (!count && !isReading && !result)} onClick={clear}>{t.clear} ↗</button></aside>
    </div>{view !== 'studio' && policy}</main>
    <footer><span><strong>{t.brand}</strong><span className="footer-dot">/</span>{t.footer}</span><div><button className="text-button" onClick={() => switchView('privacy')}>{t.privacy}</button><button className="text-button" onClick={() => switchView('terms')}>{t.terms}</button><span>© 2026 {t.brand}</span></div></footer>
    <dialog ref={dialog} onCancel={event => { if (loginBusy) event.preventDefault(); }} onClose={() => { setShowPassword(false); dialog.current?.querySelector('form')?.reset(); }} aria-labelledby="login-heading"><form onSubmit={signIn}><button type="button" className="close" disabled={loginBusy} onClick={() => dialog.current?.close()} aria-label={t.close}>×</button><span className="logo">✦</span><h2 id="login-heading">{t.loginTitle}</h2><p className="dialog-intro">{t.loginIntro}</p>{auth === 'ready' ? <><label htmlFor="login-username">{t.username}</label><input id="login-username" name="username" autoComplete="username" maxLength={100} required disabled={loginBusy} /><label htmlFor="login-password">{t.password}</label><div className="password-field"><input id="login-password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" maxLength={200} required disabled={loginBusy} /><button type="button" className="text-button" aria-pressed={showPassword} disabled={loginBusy} onClick={() => setShowPassword(!showPassword)}>{showPassword ? t.hidePassword : t.showPassword}</button></div>{loginError && <p id="login-error" role="alert">{t[loginError]}</p>}<button className="primary" type="submit" disabled={loginBusy} aria-busy={loginBusy}>{loginBusy ? t.loggingIn : t.login}</button></> : <div className="login-availability"><p role="status">{t[auth]}</p>{auth !== 'checking' && <button type="button" className="secondary-button" onClick={() => void checkAccount()}>{t.retry}</button>}<button type="button" className="primary" onClick={() => { dialog.current?.close(); switchView('studio'); }}>{t.back}</button></div>}</form></dialog>
  </>;
}
async function rasterMaterials(person: string, clothing: string) {
  const [first, second] = await Promise.all([makePreviews(person, clothing), makePreviews(clothing, person)]);
  return { personImage: first.original, clothingImage: second.original };
}
