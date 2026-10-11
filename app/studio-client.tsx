'use client';
/* eslint-disable @next/next/no-img-element */
// 工作台编排器：保留语言/视图/导航/hero/steps/衣橱/登录对话框/页脚与本地预览流程，
// 新增演示 Credits 任务状态机：提交前展示消耗与余额，提交后服务端冻结，
// 成功先出结果再结算、失败/取消/超时退还，幂等键防重复扣费，
// 断网先按幂等键/active 接口找回任务，刷新或重新登录自动恢复进度。
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { processingBlock } from './processing-policy';
import TrustPolicy from './trust-policy';
import ClothingLibrary from './clothing-library';
import UploadZone from './upload-zone';
import ParamsZone from './params-zone';
import TaskZone from './task-zone';
import ResultZone from './result-zone';
import { copy, type CopyKey, type Language } from './studio-copy';
import { makePreviews, readMaterial, sampleMaterials, type Material } from './studio-images';
import { QUALITY_COST, type Quality } from './pricing';
import { browserSupabase } from './lib/supabase/client';
import type { CreditsView, Kind, LedgerEntry, ServerTask, StudioResult, TaskPhase } from './studio-types';

type View = 'studio' | 'privacy' | 'terms';
type User = { username: string };
type Notice = { key: CopyKey; error?: boolean; count?: number };
type RequestError = Error & { data?: { task?: ServerTask; credits?: CreditsView; code?: string } };
const POLL_INTERVAL = 1800;
const POLL_BUDGET = 25;
const errorKeys: Record<string, CopyKey> = {
  AUTH_UNAVAILABLE: 'unavailable', AUTH_REQUIRED: 'authNeeded', INVALID_CREDENTIALS: 'wrongPassword',
  INVALID_ORIGIN: 'invalidOrigin', RATE_LIMITED: 'rateLimited', INVALID_IMAGE: 'invalid', INVALID_REQUEST: 'invalidRequest',
  BLANK_CLOTHING: 'blankClothing', MISSING_CLOTHING: 'needClothing', SAFETY_CONSENT_REQUIRED: 'needSafety', SERVER_CONSENT_REQUIRED: 'serverConsentRequired', MODERATION_UNAVAILABLE: 'moderationUnavailable',
  CONSENT_REQUIRED: 'needConsent', QUOTA_EXCEEDED: 'quota', PROCESSING: 'serverBusy',
  INSUFFICIENT_CREDITS: 'insufficientCredits', TASK_IN_PROGRESS: 'taskInProgress', TASK_NOT_FOUND: 'taskGone',
  RESULT_NOT_READY: 'resultNotReady', RESULT_GONE: 'resultGone', TASK_NOT_ACTIVE: 'taskNotActive',
  INVALID_QUALITY: 'invalidQuality', INVALID_KEY: 'invalidKey', INVALID_SOURCE: 'invalidSource',
  CONFIG_ERROR: 'configError', DB_UNAVAILABLE: 'dbUnavailable',
};
async function request(url: string, body?: unknown, timeoutMs = 30000) {
  let response: Response;
  try { response = await fetch(url, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), signal: AbortSignal.timeout(timeoutMs) }); }
  catch (error) { throw new Error(error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'networkError'); }
  let data: Record<string, unknown> | undefined;
  try { data = await response.json() as Record<string, unknown>; } catch { throw new Error('networkError'); }
  if (!response.ok) {
    const key = errorKeys[String(data?.code)] || (response.status === 401 ? 'authNeeded' : response.status === 429 ? 'rateLimited' : 'invalidRequest');
    const error = new Error(key) as RequestError;
    if (data) error.data = data as RequestError['data'];
    throw error;
  }
  return data as Record<string, unknown>;
}
function errorKey(error: unknown): CopyKey {
  return error instanceof Error && error.message in copy.zh ? error.message as CopyKey : 'exportError';
}
function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export default function Studio({ initialView = 'studio', contact = '' }: { initialView?: View; contact?: string }) {
  const [language, setLanguage] = useState<Language>('zh');
  const [showClothes, setShowClothes] = useState(false);
  const [languageReady, setLanguageReady] = useState(false);
  const [view, setView] = useState<View>(initialView);
  const [materials, setMaterials] = useState<Record<Kind, Material | null>>({ person: null, clothing: null });
  const [reading, setReading] = useState<Record<Kind, boolean>>({ person: false, clothing: false });
  const [consent, setConsent] = useState(false);
  const [safetyConsent, setSafetyConsent] = useState(false);
  const [uploadErrors, setUploadErrors] = useState<Record<Kind, CopyKey | null>>({ person: null, clothing: null });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<StudioResult | null>(null);
  const [resultView, setResultView] = useState<'board' | 'original'>('board');
  const [notice, setNotice] = useState<Notice>({ key: 'initial' });
  const [user, setUser] = useState<User | null>(null);
  const [auth, setAuth] = useState<'checking' | 'ready' | 'unavailable' | 'unknown'>('checking');
  const [authMode, setAuthMode] = useState<'demo' | 'supabase' | null>(null);
  const [authView, setAuthView] = useState<'login' | 'register'>('login');
  const [registerDone, setRegisterDone] = useState(false);
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState<CopyKey | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [quality, setQuality] = useState<Quality>('standard');
  const [credits, setCredits] = useState<CreditsView | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[] | null>(null);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [phase, setPhase] = useState<TaskPhase>('idle');
  const [task, setTask] = useState<ServerTask | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [simulateFailure, setSimulateFailure] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const loginButton = useRef<HTMLButtonElement>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const versions = useRef({ person: 0, clothing: 0 });
  const busyRef = useRef(false);
  const authVersion = useRef(0);
  const loginBusyRef = useRef(false);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const t = copy[language];
  const count = Number(Boolean(materials.person)) + Number(Boolean(materials.clothing));
  const isReading = reading.person || reading.clothing;
  const loggedInForServer = Boolean(user && auth === 'ready');
  const cost = QUALITY_COST[quality];
  const taskActive = phase === 'submitting' || phase === 'resuming' || phase === 'queued' || phase === 'processing';
  const frozenAmount = taskActive && task ? task.cost : 0;
  const canSubmit = !busy && !isReading && count === 2 && consent && safetyConsent && !taskActive && (!loggedInForServer || !credits || credits.balance >= cost);
  const primaryLabel = busy ? t.preparing : isReading ? t.reading : !materials.person ? t.needPerson : !materials.clothing ? t.needClothing : !consent ? t.needConsent : !safetyConsent ? t.needSafety : loggedInForServer ? t.submitGenerate.replace('{count}', String(cost)) : t.preview;

  function stopPolling() {
    if (pollTimer.current) { clearTimeout(pollTimer.current); pollTimer.current = null; }
  }
  function scrollToResult() {
    setTimeout(() => resultHeading.current?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }), 50);
  }
  function adoptServerTask(next: ServerTask) {
    setTask(next);
    setPhase(next.state === 'succeeded' ? 'succeeded' : next.state === 'failed' ? 'failed' : next.state === 'cancelled' ? 'cancelled' : next.state === 'processing' ? 'processing' : 'queued');
    setIdempotencyKey(next.idempotencyKey);
    if (next.simulateFailure) setSimulateFailure(true);
  }
  async function refreshCredits() {
    try { const data = await request('/api/credits/balance', undefined, 5000) as CreditsView; setCredits(data); }
    catch { setNotice({ key: 'creditsUnavailable', error: true }); }
  }
  // 终态收尾：结果先于结算已在服务端保证；这里只同步 UI 与余额。
  async function finalizeTask(next: ServerTask, creditsView?: CreditsView) {
    stopPolling();
    setTask(next);
    setPhase(next.state === 'succeeded' ? 'succeeded' : next.state === 'failed' ? 'failed' : 'cancelled');
    if (creditsView) setCredits(creditsView); else await refreshCredits();
    if (next.state === 'succeeded') {
      if (materials.person) setResult({ board: `/api/tasks/${next.id}/result`, original: materials.person.url, server: true, taskId: next.id });
      setResultView('board');
      setNotice({ key: 'generatedDone', count: next.cost });
      if (next.simulateFailure) setSimulateFailure(false);
      scrollToResult();
    } else if (next.state === 'failed') {
      setNotice({ key: 'failureTitle', error: true });
    } else {
      setNotice({ key: 'taskCancelled' });
    }
    busyRef.current = false;
    setBusy(false);
  }
  // 轮询耗尽或连续网络失败：先查 active 再判失败。
  async function recoverByActive(taskId: string) {
    try {
      const data = await request('/api/tasks/active', undefined, 5000) as { task: ServerTask | null; credits: CreditsView };
      setCredits(data.credits);
      if (data.task && data.task.id === taskId) {
        if (data.task.state === 'queued' || data.task.state === 'processing') { adoptServerTask(data.task); startPolling(taskId); return; }
        await finalizeTask(data.task, data.credits);
        return;
      }
      stopPolling(); setPhase('idle'); setNotice({ key: 'taskGone', error: true });
    } catch {
      stopPolling(); setPhase('idle'); setNotice({ key: 'resumeChecking', error: true });
    } finally {
      if (pollTimer.current === null && busyRef.current) { busyRef.current = false; setBusy(false); }
    }
  }
  function startPolling(taskId: string) {
    stopPolling();
    let attempts = 0;
    const tick = () => {
      void (async () => {
        attempts += 1;
        try {
          const data = await request(`/api/tasks/${taskId}`, undefined, 5000) as { task: ServerTask };
          if (data.task.state === 'queued' || data.task.state === 'processing') {
            setTask(data.task);
            setPhase(data.task.state);
            if (attempts < POLL_BUDGET) pollTimer.current = setTimeout(tick, POLL_INTERVAL);
            else await recoverByActive(taskId);
          } else await finalizeTask(data.task);
        } catch (error) {
          if (errorKey(error) === 'authNeeded') { stopPolling(); setNotice({ key: 'authNeeded', error: true }); openLogin(); return; }
          if (attempts < POLL_BUDGET) pollTimer.current = setTimeout(tick, POLL_INTERVAL);
          else await recoverByActive(taskId);
        }
      })();
    };
    pollTimer.current = setTimeout(tick, POLL_INTERVAL);
  }
  // 提交服务端演示生成：幂等键防重复扣费；响应丢失先按键找回，再原键重发。
  async function submitServerTask(key: string) {
    setPhase('submitting'); setIdempotencyKey(key); busyRef.current = true; setBusy(true); setNotice({ key: 'preparing' });
    const body = { privacyConsent: true, safetyConsent: true, serverConsent: true, quality, idempotencyKey: key, simulateFailure, source: 'demo' };
    try {
      const data = await request('/api/generate', body) as { task: ServerTask; credits: CreditsView };
      adoptServerTask(data.task); setCredits(data.credits);
      if (data.task.state === 'queued' || data.task.state === 'processing') { startPolling(data.task.id); setNotice({ key: 'progressQueued' }); }
      else await finalizeTask(data.task, data.credits);
    } catch (error) {
      const keyError = errorKey(error);
      const data = (error as RequestError).data;
      if (keyError === 'taskInProgress' && data?.task) {
        adoptServerTask(data.task);
        if (data.credits) setCredits(data.credits);
        if (data.task.state === 'queued' || data.task.state === 'processing') { startPolling(data.task.id); setNotice({ key: 'taskResumed' }); }
        else await finalizeTask(data.task, data.credits);
        return;
      }
      if (keyError === 'insufficientCredits') {
        if (data?.credits) setCredits(data.credits);
        setNotice({ key: 'insufficientCredits', error: true });
        busyRef.current = false; setBusy(false); setPhase('idle');
        return;
      }
      if (keyError === 'networkError' || keyError === 'timeout') {
        try {
          const found = await request(`/api/tasks/by-key/${key}`, undefined, 5000) as { task: ServerTask; credits: CreditsView };
          adoptServerTask(found.task); setCredits(found.credits);
          if (found.task.state === 'queued' || found.task.state === 'processing') { startPolling(found.task.id); setNotice({ key: 'taskResumed' }); }
          else await finalizeTask(found.task, found.credits);
        } catch (inner) {
          if (errorKey(inner) === 'taskGone') {
            // 服务器没收到：用同一幂等键重发（服务端幂等返回 reused，不会重复扣费）。
            try {
              const retried = await request('/api/generate', body) as { task: ServerTask; credits: CreditsView };
              adoptServerTask(retried.task); setCredits(retried.credits);
              if (retried.task.state === 'queued' || retried.task.state === 'processing') { startPolling(retried.task.id); setNotice({ key: 'taskResumed' }); }
              else await finalizeTask(retried.task, retried.credits);
            } catch (retryError) {
              const retryData = (retryError as RequestError).data;
              if (errorKey(retryError) === 'taskInProgress' && retryData?.task) {
                adoptServerTask(retryData.task);
                if (retryData.credits) setCredits(retryData.credits);
                if (retryData.task.state === 'queued' || retryData.task.state === 'processing') { startPolling(retryData.task.id); setNotice({ key: 'taskResumed' }); }
                else await finalizeTask(retryData.task, retryData.credits);
              } else {
                setNotice({ key: 'resumeChecking', error: true });
                busyRef.current = false; setBusy(false); setPhase('idle');
              }
            }
          } else {
            setNotice({ key: 'resumeChecking', error: true });
            busyRef.current = false; setBusy(false); setPhase('idle');
          }
        }
        return;
      }
      setNotice({ key: keyError, error: true });
      busyRef.current = false; setBusy(false); setPhase('idle');
    }
  }
  // 刷新/重新登录后恢复：查 active 任务并接续进度。
  async function resumeSession() {
    setPhase('resuming');
    try {
      const data = await request('/api/tasks/active', undefined, 5000) as { task: ServerTask | null; credits: CreditsView };
      setCredits(data.credits);
      if (data.task) {
        adoptServerTask(data.task);
        if (data.task.state === 'queued' || data.task.state === 'processing') {
          busyRef.current = true; setBusy(true); setNotice({ key: 'taskResumed' });
          startPolling(data.task.id);
        } else await finalizeTask(data.task, data.credits);
      } else setPhase('idle');
    } catch {
      setPhase('idle');
      setNotice({ key: 'creditsUnavailable', error: true });
    }
  }
  async function checkAccount() {
    const version = ++authVersion.current; setAuth('checking');
    try {
      const data = await request('/api/auth/me');
      if (version !== authVersion.current) return;
      setUser(data.user as User | null);
      setAuthMode(data.authMode === 'supabase' ? 'supabase' : 'demo');
      setAuth(data.loginAvailable ? 'ready' : 'unavailable');
      if (data.user) void resumeSession();
    } catch (error) {
      if (version !== authVersion.current) return;
      const code = (error as RequestError).data?.code;
      setAuth('unknown');
      // 服务器配置无效 / 数据库不可用：明确提示，不伪装成普通断网。
      if (code === 'CONFIG_ERROR') setNotice({ key: 'configError', error: true });
      else if (code === 'DB_UNAVAILABLE') setNotice({ key: 'dbUnavailable', error: true });
    }
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
    // 仅挂载时执行一次：checkAccount 通过 authVersion ref 防过期，无需重订阅。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => () => stopPolling(), []);
  useEffect(() => {
    if (!languageReady) return;
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
    document.title = language === 'zh' ? '衣搭灵感 · AI 穿搭与虚拟试衣' : 'Style Muse · AI styling & virtual try-on';
    try { localStorage.setItem('style-muse-language', language); } catch { /* Optional preference storage. */ }
  }, [language, languageReady]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (!busyRef.current) {
        versions.current.person++; versions.current.clothing++;
        stopPolling(); setTask(null); setPhase('idle'); setIdempotencyKey(null); setLedger(null);
        setMaterials({ person: null, clothing: null }); setReading({ person: false, clothing: false }); setUploadErrors({ person: null, clothing: null });
        setResult(null); setConsent(false); setSafetyConsent(false); setNotice({ key: 'expired' });
      }
    }, 30 * 60 * 1000);
    return () => clearInterval(timer);
  }, []);
  function switchView(next: View) {
    setView(next); const url = new URL(window.location.href); url.pathname = '/'; url.searchParams.set('view', next); url.hash = '';
    window.history.pushState(null, '', url); window.scrollTo({ top: 0, behavior: 'instant' });
  }
  function clear() {
    if (busyRef.current) return;
    stopPolling(); setTask(null); setPhase('idle'); setIdempotencyKey(null); setLedger(null);
    versions.current.person++; versions.current.clothing++; setMaterials({ person: null, clothing: null }); setReading({ person: false, clothing: false }); setUploadErrors({ person: null, clothing: null }); setResult(null); setConsent(false); setSafetyConsent(false); setNotice({ key: 'cleared' });
  }
  function remove(kind: Kind) {
    if (busyRef.current) return;
    stopPolling(); setTask(null); setPhase('idle'); setIdempotencyKey(null);
    versions.current[kind]++; setReading(old => ({ ...old, [kind]: false })); setMaterials(old => ({ ...old, [kind]: null })); setResult(null); setConsent(false); setSafetyConsent(false); setUploadErrors(old => ({ ...old, [kind]: null })); setNotice({ key: 'initial' });
  }
  async function choose(kind: Kind, file?: File) {
    if (!file || busyRef.current) return;
    const version = ++versions.current[kind]; stopPolling(); setTask(null); setPhase('idle'); setIdempotencyKey(null);
    setMaterials(old => ({ ...old, [kind]: null })); setResult(null); setConsent(false); setSafetyConsent(false); setUploadErrors(old => ({ ...old, [kind]: null })); setReading(old => ({ ...old, [kind]: true }));
    try { const material = await readMaterial(file, kind); if (versions.current[kind] !== version) return; setMaterials(old => ({ ...old, [kind]: material })); setResult(null); setNotice({ key: 'selected' }); }
    catch (error) { if (versions.current[kind] === version) { setUploadErrors(old => ({ ...old, [kind]: errorKey(error) })); setNotice({ key: errorKey(error), error: true }); } }
    finally { if (versions.current[kind] === version) setReading(old => ({ ...old, [kind]: false })); }
  }
  function useSamples() {
    if (busyRef.current) return;
    stopPolling(); setTask(null); setPhase('idle'); setIdempotencyKey(null);
    versions.current.person++; versions.current.clothing++; setReading({ person: false, clothing: false }); setUploadErrors({ person: null, clothing: null }); setMaterials(sampleMaterials()); setResult(null); setConsent(false); setSafetyConsent(false); setNotice({ key: 'selected' });
  }
  function openLogin() { setLoginError(null); setShowPassword(false); setAuthView('login'); setRegisterDone(false); dialog.current?.showModal(); }
  async function process() {
    if (busyRef.current || isReading) return;
    const block = processingBlock(materials, consent, safetyConsent);
    if (block) { setResult(null); setNotice({ key: block === 'needClothing' ? uploadErrors.clothing || block : block, error: true }); return; }
    if (!materials.person || !materials.clothing) return;
    if (loggedInForServer) { await submitServerTask(newIdempotencyKey()); return; }
    const personVersion = versions.current.person, clothingVersion = versions.current.clothing;
    busyRef.current = true; setBusy(true); setNotice({ key: 'preparing' });
    try {
      const next = await makePreviews(materials.person.url, materials.clothing.url);
      if (versions.current.person !== personVersion || versions.current.clothing !== clothingVersion) return;
      setResult(next); setResultView('board'); setNotice({ key: 'localDone' });
      scrollToResult();
    } catch (error) { setNotice({ key: errorKey(error), error: true }); }
    finally { busyRef.current = false; setBusy(false); }
  }
  // 失败兜底：改用本地预览（内置素材无需上传、不消耗 Credits）。
  async function previewLocally() {
    if (busyRef.current || isReading) return;
    if (!materials.person || !materials.clothing) return;
    const personVersion = versions.current.person, clothingVersion = versions.current.clothing;
    stopPolling(); setTask(null); setPhase('idle');
    busyRef.current = true; setBusy(true); setNotice({ key: 'preparing' });
    try {
      const next = await makePreviews(materials.person.url, materials.clothing.url);
      if (versions.current.person !== personVersion || versions.current.clothing !== clothingVersion) return;
      setResult(next); setResultView('board'); setNotice({ key: 'localDone' });
      scrollToResult();
    } catch (error) { setNotice({ key: errorKey(error), error: true }); }
    finally { busyRef.current = false; setBusy(false); }
  }
  // 重试/重新生成：新幂等键、新任务、重新检查余额。
  function retryTask() {
    if (busyRef.current) return;
    stopPolling(); setTask(null); setPhase('idle'); setResult(null);
    void process();
  }
  async function cancelActive() {
    if (!task || cancelBusy) return;
    setCancelBusy(true);
    try {
      const data = await request(`/api/tasks/${task.id}/cancel`, {}, 10000) as { task: ServerTask };
      await finalizeTask(data.task);
    } catch (error) { setNotice({ key: errorKey(error), error: true }); }
    finally { setCancelBusy(false); }
  }
  async function saveResult() {
    if (!result?.taskId || saving) return;
    setSaving(true);
    try {
      const data = await request(`/api/tasks/${result.taskId}/save`, {}, 10000) as { task: ServerTask };
      setTask(data.task);
      setNotice({ key: 'savedDone' });
    } catch (error) { setNotice({ key: errorKey(error), error: true }); }
    finally { setSaving(false); }
  }
  async function toggleLedger(open: boolean) {
    if (!open || ledger) return;
    setLedgerLoading(true);
    try {
      const data = await request('/api/credits/ledger', undefined, 5000) as { entries: LedgerEntry[]; balance: number; frozen: number; simulated: true; storage?: 'memory' | 'database' };
      setLedger(data.entries);
      setCredits({ balance: data.balance, frozen: data.frozen, simulated: true, storage: data.storage });
    } catch { setNotice({ key: 'creditsUnavailable', error: true }); }
    finally { setLedgerLoading(false); }
  }
  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (loginBusyRef.current || auth !== 'ready') return;
    const form = event.currentTarget; const fields = new FormData(form); loginBusyRef.current = true; setLoginBusy(true); setLoginError(null); authVersion.current++;
    try {
      await request('/api/auth/login', { username: String(fields.get('username')).trim(), password: fields.get('password') });
      const session = await request('/api/auth/me'); if (!session.user) throw new Error('cookieError');
      setUser(session.user as User); setAuth('ready'); dialog.current?.close(); form.reset(); setNotice({ key: 'loggedIn' }); loginButton.current?.focus();
      void resumeSession();
    } catch (error) { setLoginError(errorKey(error)); if (errorKey(error) === 'unavailable') setAuth('unavailable'); }
    finally { loginBusyRef.current = false; setLoginBusy(false); }
  }
  // Supabase 模式：浏览器客户端直连 Supabase Auth（官方 @supabase/ssr 模式），
  // 会话经 Cookie 保存在本站域名下，服务端每次请求用 getUser() 校验身份。
  // 注册/登录失败的错误消息只做已知类别的映射，不把原始错误直接展示。
  async function supabaseSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (loginBusyRef.current || auth !== 'ready') return;
    const form = event.currentTarget; const fields = new FormData(form); loginBusyRef.current = true; setLoginBusy(true); setLoginError(null); authVersion.current++;
    try {
      const { error } = await browserSupabase().auth.signInWithPassword({ email: String(fields.get('email')).trim(), password: String(fields.get('password')) });
      if (error) { setLoginError(error.message.includes('Invalid login credentials') ? 'wrongCredentials' : 'unknown'); return; }
      const session = await request('/api/auth/me'); if (!session.user) throw new Error('cookieError');
      setUser(session.user as User); setAuth('ready'); dialog.current?.close(); form.reset(); setNotice({ key: 'loggedIn' }); loginButton.current?.focus();
      void resumeSession();
    } catch (error) {
      if (error instanceof Error && error.message === 'supabase-unconfigured') { setLoginError('unavailable'); setAuth('unavailable'); return; }
      const key = errorKey(error);
      setLoginError(key === 'exportError' ? 'unknown' : key);
      if (key === 'unavailable') setAuth('unavailable');
    }
    finally { loginBusyRef.current = false; setLoginBusy(false); }
  }
  async function supabaseRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (loginBusyRef.current || auth !== 'ready') return;
    const form = event.currentTarget; const fields = new FormData(form); loginBusyRef.current = true; setLoginBusy(true); setLoginError(null); setRegisterDone(false); authVersion.current++;
    try {
      const { data, error } = await browserSupabase().auth.signUp({ email: String(fields.get('email')).trim(), password: String(fields.get('password')) });
      if (error) {
        const message = error.message;
        setLoginError(message.includes('already registered') ? 'emailTaken' : message.includes('Password') && message.includes('least') ? 'passwordTooShort' : 'registerFailed');
        return;
      }
      // 项目开启邮箱确认时 signUp 不返回会话：提示查收邮件，留在注册页。
      if (!data.session) { setRegisterDone(true); return; }
      const session = await request('/api/auth/me'); if (!session.user) throw new Error('cookieError');
      setUser(session.user as User); setAuth('ready'); dialog.current?.close(); form.reset(); setNotice({ key: 'loggedIn' }); loginButton.current?.focus();
      void resumeSession();
    } catch (error) {
      if (error instanceof Error && error.message === 'supabase-unconfigured') { setLoginError('unavailable'); setAuth('unavailable'); return; }
      const key = errorKey(error);
      setLoginError(key === 'exportError' ? 'registerFailed' : key);
    }
    finally { loginBusyRef.current = false; setLoginBusy(false); }
  }
  function handleAuthSubmit(event: FormEvent<HTMLFormElement>) {
    if (authMode === 'supabase') { if (authView === 'login') void supabaseSignIn(event); else void supabaseRegister(event); return; }
    void signIn(event);
  }
  async function signOut() {
    if (loginBusyRef.current || busyRef.current) return; loginBusyRef.current = true; setLoginBusy(true); authVersion.current++;
    try {
      // 有活动任务时先尽力取消（服务端释放冻结），失败也继续登出。
      if (task && (phase === 'queued' || phase === 'processing')) { try { await request(`/api/tasks/${task.id}/cancel`, {}, 10000); } catch { /* 忽略 */ } }
      if (authMode === 'supabase') await browserSupabase().auth.signOut();
      else await request('/api/auth/logout', {});
      stopPolling();
      setUser(null); clear(); setNotice({ key: 'signedOut' });
    } catch (error) { setNotice({ key: errorKey(error), error: true }); }
    finally { loginBusyRef.current = false; setLoginBusy(false); }
  }
  const policy = <section className="policy-panel" aria-labelledby="policy-heading"><span className="tiny-label">STYLE MUSE / TRUST</span><h1 id="policy-heading">{view === 'terms' ? t.termsTitle : t.privacyTitle}</h1><p className="policy-intro">{view === 'terms' ? t.termsText : t.privacyIntro}</p><p className="policy-date">{t.updated}</p>{view === 'terms' ? <p>{t.limits}</p> : <><div className="policy-grid">{(['Local', 'Server', 'Delete', 'Account'] as const).map(key => <article key={key}><h2>{t[`privacy${key}`]}</h2><p>{t[`privacy${key}Text`]}</p></article>)}</div></>}<TrustPolicy language={language} contact={contact} /><button className="primary policy-back" onClick={() => switchView('studio')}>{t.back} →</button></section>;
  return <>
    <header className="nav studio-nav"><button className="brand brand-button" onClick={() => switchView('studio')} aria-label={t.brand}><span className="logo">✦</span><strong>{t.brand} <span>AI</span></strong></button>
      <nav className="view-switch" aria-label={language === 'zh' ? '主导航' : 'Main navigation'}><button type="button" aria-pressed={view === 'studio'} onClick={() => switchView('studio')}>{t.studio}</button><button type="button" aria-pressed={view === 'studio' && showClothes} aria-controls="clothing-library" onClick={() => { switchView('studio'); setShowClothes(old => !old); }}>{language === 'zh' ? '衣服' : 'Clothes'}</button><button type="button" aria-pressed={view === 'privacy'} onClick={() => switchView('privacy')}>{t.privacy}</button></nav>
      <div className="header-controls"><label className="language-control"><span aria-hidden="true">◎</span><select aria-label={t.language} value={language} onChange={event => setLanguage(event.target.value as Language)}><option value="zh">简体中文</option><option value="en">English</option></select></label><button ref={loginButton} type="button" className="sign-in-button" disabled={loginBusy || busy} onClick={() => user ? void signOut() : openLogin()}>{user ? t.logout : t.login}</button></div>
    </header>
    <main className="studio-main"><div hidden={view !== 'studio'}>
      <section className="hero"><div className="hero-copy"><span className="eyebrow"><span className="dot" />{t.eyebrow}</span><h1>{t.heading}<br /><em>{t.accent}</em></h1><p>{t.intro}</p><div className="hero-chips"><span>◇ {t.localChip}</span><span>↗ {t.exportChip}</span></div></div><div className="hero-art new-hero-art" aria-hidden="true"><div className="art-card art-person"><span>THE MUSE</span><img src={sampleMaterials().person.url} alt="" /></div><div className="art-card art-clothing"><span>THE LOOK</span><img src={sampleMaterials().clothing.url} alt="" /></div><div className="art-spark">✦</div></div></section>
      <section className="studio-section"><div className="studio-toolbar"><div><span className="tiny-label">CREATE YOUR NEXT LOOK</span><h2>{t.title} <span className="demo-tag">{t.demo}</span></h2></div><span className="toolbar-note">{t.demoNote}</span></div>
        <ol className="steps">{[t.step1, t.step2, t.step3].map((label, index) => { const active = result ? 2 : count === 2 ? 1 : 0; return <li key={index} className={index === active ? 'active' : index < active ? 'done' : ''} aria-current={index === active ? 'step' : undefined}><span>0{index + 1}</span><strong>{label}</strong></li>; })}</ol>
        <ClothingLibrary open={showClothes} language={language} disabled={busy} selectedUrl={materials.clothing?.url} onSelect={material => { if (busyRef.current) return; stopPolling(); setTask(null); setPhase('idle'); setIdempotencyKey(null); versions.current.clothing++; setReading(old => ({ ...old, clothing: false })); setMaterials(old => ({ ...old, clothing: material })); setResult(null); setConsent(false); setSafetyConsent(false); setUploadErrors(old => ({ ...old, clothing: null })); setNotice({ key: 'selected' }); }} />
        <div className="studio-grid">
          <div className="studio-zones">
            <UploadZone t={t} materials={materials} reading={reading} uploadErrors={uploadErrors} consent={consent} safetyConsent={safetyConsent} busy={busy} count={count} wardrobeOpen={showClothes} onChoose={(kind, file) => void choose(kind, file)} onRemove={remove} onUseSamples={useSamples} onToggleClothes={() => setShowClothes(old => !old)} onConsentChange={checked => { if (!checked) clear(); else setConsent(true); }} onSafetyConsentChange={checked => { setSafetyConsent(checked); if (!checked) setResult(null); }} onReadPrivacy={() => switchView('privacy')} />
            <TaskZone t={t} phase={phase} task={task} idempotencyKey={idempotencyKey} cost={cost} simulateFailure={simulateFailure} onSimulateFailureChange={setSimulateFailure} busy={busy} cancelBusy={cancelBusy} frozenAmount={frozenAmount} notice={notice} loggedIn={loggedInForServer} creditsBalance={credits?.balance ?? null} canSubmit={canSubmit} primaryLabel={primaryLabel} onSubmit={() => void process()} onRetry={retryTask} onCancelTask={() => void cancelActive()} onUseLocalPreview={() => void previewLocally()} onResumeCheck={() => void resumeSession()} />
          </div>
          <div className="studio-zones">
            <ParamsZone t={t} quality={quality} onQualityChange={setQuality} credits={credits} loggedIn={loggedInForServer} dbMode={authMode === 'supabase'} ledger={ledger} ledgerLoading={ledgerLoading} onToggleLedger={open => void toggleLedger(open)} busy={busy} />
            <ResultZone t={t} result={result} resultView={resultView} onViewChange={setResultView} busy={busy} task={task} saving={saving} onSave={() => void saveResult()} onRegenerate={retryTask} headingRef={resultHeading} />
          </div>
        </div>
      </section><aside className="privacy-bar"><div className="privacy-copy"><span className="privacy-icon" aria-hidden="true">◇</span><div><strong>{t.privacyTitle}</strong><p>{t.clearHelp}</p></div></div><button type="button" id="clear-images" disabled={busy || (!count && !isReading && !result)} onClick={clear}>{t.withdraw} ↗</button></aside>
    </div>{view !== 'studio' && policy}</main>
    <footer><span><strong>{t.brand}</strong><span className="footer-dot">/</span>{t.footer}</span><div><button className="text-button" onClick={() => switchView('privacy')}>{t.privacy}</button><button className="text-button" onClick={() => switchView('terms')}>{t.terms}</button><span>© 2026 {t.brand}</span></div></footer>
    <dialog ref={dialog} onCancel={event => { if (loginBusy) event.preventDefault(); }} onClose={() => { setShowPassword(false); dialog.current?.querySelector('form')?.reset(); }} aria-labelledby="login-heading"><form onSubmit={handleAuthSubmit}><button type="button" className="close" disabled={loginBusy} onClick={() => dialog.current?.close()} aria-label={t.close}>×</button><span className="logo">✦</span>{auth === 'ready' && authMode === 'supabase' ? <><h2 id="login-heading">{authView === 'login' ? t.loginTitle : t.registerTitle}</h2><p className="dialog-intro">{authView === 'login' ? t.loginIntro : t.registerIntro}</p><div className="auth-tabs" role="tablist" aria-label={authView === 'login' ? t.authModeLogin : t.authModeRegister}><button type="button" role="tab" aria-selected={authView === 'login'} disabled={loginBusy} onClick={() => { setAuthView('login'); setLoginError(null); setRegisterDone(false); }}>{t.authModeLogin}</button><button type="button" role="tab" aria-selected={authView === 'register'} disabled={loginBusy} onClick={() => { setAuthView('register'); setLoginError(null); setRegisterDone(false); }}>{t.authModeRegister}</button></div><label htmlFor="auth-email">{t.emailLabel}</label><input id="auth-email" name="email" type="email" autoComplete="email" maxLength={200} required disabled={loginBusy} /><label htmlFor="auth-password">{t.password}</label><div className="password-field"><input id="auth-password" name="password" type={showPassword ? 'text' : 'password'} autoComplete={authView === 'login' ? 'current-password' : 'new-password'} maxLength={200} required disabled={loginBusy} /><button type="button" className="text-button" aria-pressed={showPassword} disabled={loginBusy} onClick={() => setShowPassword(!showPassword)}>{showPassword ? t.hidePassword : t.showPassword}</button></div>{registerDone && <p className="dialog-note" role="status">{t.confirmEmailSent}</p>}{authView === 'register' && !registerDone && <p className="dialog-note">{t.registerHint}</p>}{loginError && <p id="login-error" role="alert">{t[loginError]}</p>}<button className="primary" type="submit" disabled={loginBusy} aria-busy={loginBusy}>{loginBusy ? (authView === 'register' ? t.registering : t.loggingIn) : authView === 'register' ? t.registerButton : t.login}</button><button type="button" className="text-button auth-switch" disabled={loginBusy} onClick={() => { setAuthView(authView === 'login' ? 'register' : 'login'); setLoginError(null); setRegisterDone(false); }}>{authView === 'login' ? t.authSwitchRegister : t.authSwitchLogin}</button></> : auth === 'ready' ? <><h2 id="login-heading">{t.loginTitle}</h2><p className="dialog-intro">{t.loginIntro}</p><label htmlFor="login-username">{t.username}</label><input id="login-username" name="username" autoComplete="username" maxLength={100} required disabled={loginBusy} /><label htmlFor="login-password">{t.password}</label><div className="password-field"><input id="login-password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" maxLength={200} required disabled={loginBusy} /><button type="button" className="text-button" aria-pressed={showPassword} disabled={loginBusy} onClick={() => setShowPassword(!showPassword)}>{showPassword ? t.hidePassword : t.showPassword}</button></div>{loginError && <p id="login-error" role="alert">{t[loginError]}</p>}<button className="primary" type="submit" disabled={loginBusy} aria-busy={loginBusy}>{loginBusy ? t.loggingIn : t.login}</button></> : <><h2 id="login-heading">{t.loginTitle}</h2><p className="dialog-intro">{t.loginIntro}</p><div className="login-availability"><p role="status">{t[auth]}</p>{auth !== 'checking' && <button type="button" className="secondary-button" onClick={() => void checkAccount()}>{t.retry}</button>}<button type="button" className="primary" onClick={() => { dialog.current?.close(); switchView('studio'); }}>{t.back}</button></div></>}</form></dialog>
  </>;
}
