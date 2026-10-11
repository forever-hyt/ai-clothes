// 工作台 API（catch-all）。按 APP_MODE 分两条路径，见 app/server/storage.ts：
// - demo（默认）：内存会话 + 内存账本/任务，行为与原受限演示版完全一致；
// - production：Supabase Auth 身份（服务端 getUser 校验）+ PostgreSQL 事务
//   账本/任务。APP_MODE 非法或 production 配置缺失 → 503 CONFIG_ERROR；
//   数据库不可用（含迁移未执行）→ 503 DB_UNAVAILABLE，绝不回退内存账本。
//
// 浏览器本地永远只是显示，不是账本：Credits 冻结/结算/释放全部由服务端完成，
// 数据库模式下客户端（anon/authenticated）对账本零写权限（见 docs/supabase-schema.sql）。
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import sharp from 'sharp';
import { isBlankPixels } from '../../image-validation.mjs';
import { appMode, DbUnavailableError, snapshot, ledgerView, submitTask, getTask, getActiveTask, getTaskByKey, cancelTask, saveTask, publicTask, type Task } from '../../server/storage';
import { createServerSupabase } from '../../lib/supabase/server';
import { ensureProfile } from '../../server/db/credits-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const TTL = 2 * 60 * 60 * 1000;
const MAX_BODY = 15 * 1024 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_ID_RE = /^[a-f0-9]{32}$/;
// 任务 id：demo 为 32 位十六进制，数据库模式为 uuid；查询均按用户归属过滤，
// 格式不符统一按「不存在」处理。
const TASK_ACTION_RE = /^\/api\/tasks\/([0-9a-f-]{32,36})\/(save|cancel)$/;
const TASK_GET_RE = /^\/api\/tasks\/([0-9a-f-]{32,36})(\/result)?$/;
const TASK_BY_KEY_RE = /^\/api\/tasks\/by-key\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const globalStore = globalThis as typeof globalThis & { tryOnSessions?: Map<string, number> };
const sessions = globalStore.tryOnSessions ??= new Map<string, number>();
const username = process.env.LOGIN_USERNAME || '';
const configuredHash = process.env.LOGIN_PASSWORD_HASH || '';
const hashReady = /^[a-f0-9]{32}:[a-f0-9]{128}$/.test(configuredHash);
const salt = hashReady ? Buffer.from(configuredHash.split(':')[0], 'hex') : randomBytes(16);
const hash = hashReady ? Buffer.from(configuredHash.split(':')[1], 'hex') : randomBytes(64);
const limits = new Map<string, { count: number; expiry: number }>();
const usage = { day: '', count: 0 };
let processing = false;
function envInt(name: string, fallback: number) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}
function limited(key: string, maximum: number, duration: number) {
  const now = Date.now();
  for (const [id, entry] of limits) if (entry.expiry <= now) limits.delete(id);
  const entry = limits.get(key) || { count: 0, expiry: now + duration };
  entry.count++; limits.set(key, entry);
  return entry.count > maximum;
}
async function cleanImage(value: unknown, clothing = false) {
  if (!validImage(value)) throw new Error('invalid image');
  const input = Buffer.from((value as string).split(',')[1], 'base64');
  const decoder = sharp(input, { limitInputPixels: 20000000, failOn: 'warning' });
  const metadata = await decoder.metadata();
  const declared = (value as string).slice(5, (value as string).indexOf(';'));
  if (`image/${metadata.format}` !== declared || (metadata.pages || 1) !== 1) throw new Error('invalid image');
  if (clothing) {
    const pixels = await sharp(input, { limitInputPixels: 20000000, failOn: 'warning' }).rotate().resize(128, 128, { fit: 'fill' }).toColourspace('srgb').ensureAlpha().raw().toBuffer();
    if (isBlankPixels(pixels)) throw new Error('BLANK_CLOTHING');
  }
  // Re-encoding drops EXIF, GPS and other metadata by default.
  return decoder.rotate().webp({ quality: 90 }).toBuffer();
}
function token(request: Request) {
  return (request.headers.get('cookie') || '').match(/(?:^|;\s*)session=([a-f0-9]{64})(?:;|$)/)?.[1] || '';
}
function purge() {
  for (const [key, expiry] of sessions) if (expiry <= Date.now()) sessions.delete(key);
}
function validTaskId(id: string) {
  return HEX_ID_RE.test(id) || UUID_RE.test(id);
}
// —— 身份解析（模式分叉点）——
// demo：内存会话 → 配置的唯一账号；production：Supabase Auth（服务端校验）。
// 数据库不可达与「未登录」严格区分：前者抛 DbUnavailableError（503），后者返回
// null（401）；ensureAccount 惰性补建 profile/余额账户（幂等，见 credits-db.ts）。
type Identity = { key: string; label: string };

async function resolveIdentity(request: Request, ensureAccount: boolean): Promise<Identity | null> {
  if (appMode.kind !== 'production') {
    return sessions.has(token(request)) ? { key: username, label: username } : null;
  }
  const supabase = await createServerSupabase();
  if (!supabase) return null; // 配置无效已在入口拦截，此处仅防御
  const { data, error } = await supabase.auth.getUser();
  if (data.user) {
    const key = data.user.id;
    if (ensureAccount) await ensureProfile(key, data.user.email ?? '');
    return { key, label: data.user.email || key };
  }
  // 无会话 → 未登录；其它错误（Supabase 不可达等）→ 数据库不可用。
  if (error && error.name !== 'AuthSessionMissingError') {
    throw new DbUnavailableError(`auth.getUser: ${error.name || error.message || 'unknown'}`);
  }
  return null;
}
const errorCodes: Record<string, string> = {
  '请先选择非空白的服装图片': 'MISSING_CLOTHING',
  '服装图片疑似空白、纯色或完全透明，请选择清晰展示衣服的图片': 'BLANK_CLOTHING',
  '请先确认非色情用途及图片处理授权': 'SAFETY_CONSENT_REQUIRED',
  '请单独同意将图片提交本站服务器': 'SERVER_CONSENT_REQUIRED',
  '内容审核与真实换装服务尚未接入，已停止处理且未生成图片': 'MODERATION_UNAVAILABLE',
  '管理员尚未配置安全登录账号': 'AUTH_UNAVAILABLE',
  '请先登录，再提交图片': 'AUTH_REQUIRED',
  '请先登录，再使用生成任务': 'AUTH_REQUIRED',
  '用户名或密码错误': 'INVALID_CREDENTIALS',
  '请求来源无效': 'INVALID_ORIGIN',
  '登录尝试过于频繁，请一分钟后重试': 'RATE_LIMITED',
  '请求过于频繁，请一分钟后重试': 'RATE_LIMITED',
  '请先确认图片处理说明': 'CONSENT_REQUIRED',
  '今日演示次数已用完（每日 20 次）': 'QUOTA_EXCEEDED',
  '已有图片正在处理，请稍后重试': 'PROCESSING',
  '请上传可解码的 JPG、PNG 或 WebP 静态图片，每张不超过 5MB，最多 2000 万像素': 'INVALID_IMAGE',
  // Credits 演示计费与任务(见 app/server/credits.ts、app/server/tasks.ts 与 SQL)。
  '余额不足，当前余额不足以支付本次生成': 'INSUFFICIENT_CREDITS',
  '已有生成任务正在进行，请等待其完成或取消': 'TASK_IN_PROGRESS',
  '生成任务不存在或已过期': 'TASK_NOT_FOUND',
  '生成结果尚未生成完成': 'RESULT_NOT_READY',
  '生成结果不存在或已过期': 'RESULT_GONE',
  '任务已结束，无法取消': 'TASK_NOT_ACTIVE',
  '请选择有效的生成质量': 'INVALID_QUALITY',
  '幂等键格式无效': 'INVALID_KEY',
  '请选择生成素材来源': 'INVALID_SOURCE',
  // APP_MODE / 数据库（production 模式，绝不回退 demo）。
  '服务器配置无效或未完成配置，服务暂不可用': 'CONFIG_ERROR',
  '数据库暂时不可用或尚未完成初始化，请稍后重试': 'DB_UNAVAILABLE',
};
function json(body: unknown, status = 200, cookie?: string) {
  const error = body && typeof body === 'object' && 'error' in body ? String(body.error) : null;
  const payload = error ? { ...body as object, code: errorCodes[error] || 'INVALID_REQUEST' } : body;
  return Response.json(payload, { status, headers: { 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', ...(cookie ? { 'Set-Cookie': cookie } : {}) } });
}
function cookie(value: string, maxAge: number) {
  return `session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${process.env.NODE_ENV === 'production' || process.env.COOKIE_SECURE === 'true' ? '; Secure' : ''}`;
}
function validImage(value: unknown) {
  if (typeof value !== 'string') return false;
  const match = value.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match || match[2].length % 4 !== 0) return false;
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length > 5 * 1024 * 1024) return false;
  if (match[1] === 'png') return bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if (match[1] === 'jpeg') return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  return bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
}
function configError() {
  return json({ error: '服务器配置无效或未完成配置，服务暂不可用' }, 503);
}
// 数据库故障统一入口：503 DB_UNAVAILABLE，详情只进服务端日志（不含密钥），
// 不返回浏览器、不泄露内部结构。
function dbFailure(error: unknown): Response | null {
  if (!(error instanceof DbUnavailableError)) return null;
  if (process.env.NODE_ENV !== 'production') console.error(`[db-unavailable] ${error.message}`);
  return json({ error: '数据库暂时不可用或尚未完成初始化，请稍后重试' }, 503);
}
// 任务结果:只由站方内置插画合成,不含任何用户内容。以独立图片响应提供,
// no-store + nosniff + CSP sandbox,直接打开页面时不会执行脚本。
function taskResult(task: Task, download: boolean) {
  if (task.state === 'queued' || task.state === 'processing') return json({ error: '生成结果尚未生成完成' }, 409);
  if (task.result === null) return json({ error: '生成结果不存在或已过期' }, 410);
  return new Response(task.result, {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'no-store, private',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      ...(download ? { 'Content-Disposition': `attachment; filename="try-on-result-${task.id}.svg"` } : {}),
    },
  });
}
export async function GET(request: Request) {
  try {
    return await handleGet(request);
  } catch (error) {
    const failed = dbFailure(error);
    if (failed) return failed;
    throw error;
  }
}
async function handleGet(request: Request) {
  const url = new URL(request.url);
  const pathname = url.pathname;
  purge();
  if (appMode.kind === 'invalid') return configError();
  if (pathname === '/api/auth/me') {
    if (appMode.kind === 'production') {
      // production：注册/登录由浏览器经 Supabase Auth 完成，这里只做服务端
      // 身份校验并回传模式；数据库不可达时按 503 失败，不伪装成「未登录」。
      const me = await resolveIdentity(request, false);
      return json({ user: me ? { username: me.label, avatar: null } : null, loginAvailable: true, authMode: 'supabase' });
    }
    return json({ user: sessions.has(token(request)) ? { username, avatar: null } : null, loginAvailable: Boolean(username && hashReady), authMode: 'demo' });
  }
  if (pathname === '/api/credits/balance') {
    const me = await resolveIdentity(request, true);
    if (!me) return json({ error: '请先登录，再使用生成任务' }, 401);
    return json({ ...(await snapshot(me.key)) });
  }
  if (pathname === '/api/credits/ledger') {
    const me = await resolveIdentity(request, true);
    if (!me) return json({ error: '请先登录，再使用生成任务' }, 401);
    return json({ ...(await ledgerView(me.key)) });
  }
  if (pathname === '/api/tasks/active') {
    const me = await resolveIdentity(request, true);
    if (!me) return json({ error: '请先登录，再使用生成任务' }, 401);
    const task = await getActiveTask(me.key);
    return json({ task: task ? publicTask(task) : null, credits: await snapshot(me.key) });
  }
  const byKey = TASK_BY_KEY_RE.exec(pathname);
  if (byKey) {
    const me = await resolveIdentity(request, true);
    if (!me) return json({ error: '请先登录，再使用生成任务' }, 401);
    const task = await getTaskByKey(me.key, byKey[1]);
    if (!task) return json({ error: '生成任务不存在或已过期' }, 404);
    return json({ task: publicTask(task), credits: await snapshot(me.key) });
  }
  const match = TASK_GET_RE.exec(pathname);
  if (match) {
    if (!validTaskId(match[1])) return json({ error: '生成任务不存在或已过期' }, 404);
    const me = await resolveIdentity(request, true);
    if (!me) return json({ error: '请先登录，再使用生成任务' }, 401);
    const task = await getTask(match[1], me.key);
    if (!task) return json({ error: '生成任务不存在或已过期' }, 404);
    if (match[2] === '/result') return taskResult(task, url.searchParams.get('download') === '1');
    return json({ task: publicTask(task) });
  }
  return json({ error: '接口不存在' }, 404);
}
export async function POST(request: Request) {
  try {
    return await handlePost(request);
  } catch (error) {
    const failed = dbFailure(error);
    if (failed) return failed;
    throw error;
  }
}
async function handlePost(request: Request) {
  const route = new URL(request.url).pathname;
  const taskAction = TASK_ACTION_RE.exec(route);
  // production 模式不开放内存会话的登录/退出与上传试穿接口：注册/登录/退出
  // 由浏览器经 Supabase Auth 直接完成（服务端身份校验见 resolveIdentity）。
  const allowed = appMode.kind === 'production' ? ['/api/generate'] : ['/api/auth/login', '/api/auth/logout', '/api/try-on', '/api/generate'];
  if (!allowed.includes(route) && !taskAction) return json({ error: '接口不存在' }, 404);
  if (appMode.kind === 'invalid') return configError();
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  let expectedOrigins: string[];
  try {
    // 优先使用 APP_ORIGIN（严格单一域名）；否则用 Host 头判断同源——
    // 代理（Cloudflare/Render）环境下 request.url 可能与公网域名不一致。
    expectedOrigins = process.env.APP_ORIGIN
      ? [new URL(process.env.APP_ORIGIN).origin]
      : host ? [`http://${host}`, `https://${host}`] : [new URL(request.url).origin];
  } catch { return json({ error: '请求来源无效' }, 503); }
  if (!expectedOrigins.includes(origin ?? '') || request.headers.get('sec-fetch-site') === 'cross-site') return json({ error: '请求来源无效' }, 403);
  purge();
  const requiresAuth = route === '/api/try-on' || route === '/api/generate' || Boolean(taskAction);
  let me: Identity | null = null;
  if (requiresAuth) {
    me = await resolveIdentity(request, true);
    if (!me) return json({ error: route === '/api/try-on' ? '请先登录，再提交图片' : '请先登录，再使用生成任务' }, 401);
  }
  if (route === '/api/auth/login' && limited('login', 10, 60000)) return json({ error: '登录尝试过于频繁，请一分钟后重试' }, 429);
  if (route === '/api/try-on' && limited('generate', 5, 60000)) return json({ error: '请求过于频繁，请一分钟后重试' }, 429);
  // 演示限流可经 DEMO_GENERATE_RATE 调整（默认 5 次/分钟），便于演示与测试完整流程。
  if (route === '/api/generate' && limited('credits-generate', envInt('DEMO_GENERATE_RATE', 5), 60000)) return json({ error: '请求过于频繁，请一分钟后重试' }, 429);
  if (route === '/api/auth/logout') {
    sessions.delete(token(request));
    return json({ ok: true }, 200, cookie('', 0));
  }
  if (!request.headers.get('content-type')?.startsWith('application/json')) return json({ error: '请求格式错误' }, 415);
  const bodyLimit = route === '/api/auth/login' ? 4096 : MAX_BODY;
  if (Number(request.headers.get('content-length')) > bodyLimit) return json({ error: '请求内容过大' }, 413);
  try {
    const reader = request.body?.getReader();
    if (!reader) return json({ error: '请求格式错误' }, 400);
    let size = 0;
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > bodyLimit) { await reader.cancel(); return json({ error: '请求内容过大，请选择 5MB 以内的图片' }, 413); }
      chunks.push(value);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object') return json({ error: '请求格式错误' }, 400);
    if (route === '/api/auth/login') {
      if (!username || !hashReady) return json({ error: '管理员尚未配置安全登录账号' }, 503);
      if (typeof body.username !== 'string' || typeof body.password !== 'string' || body.password.length > 200) return json({ error: '请输入有效的用户名和密码' }, 400);
      const correct = timingSafeEqual(scryptSync(body.password, salt, 64), hash);
      if (!correct || body.username !== username) return json({ error: '用户名或密码错误' }, 401);
      purge(); sessions.delete(token(request));
      const id = randomBytes(32).toString('hex');
      sessions.set(id, Date.now() + TTL);
      return json({ user: { username, avatar: null } }, 200, cookie(id, TTL / 1000));
    }
    if (taskAction) {
      const [, id, action] = taskAction;
      if (!validTaskId(id)) return json({ error: '生成任务不存在或已过期' }, 404);
      // requiresAuth 分支已保证 me 非空（taskAction 必触发 requiresAuth）。
      const task = await getTask(id, me!.key);
      if (!task) return json({ error: '生成任务不存在或已过期' }, 404);
      if (action === 'save') {
        if (task.state !== 'succeeded') return json({ error: '生成结果尚未生成完成' }, 409);
        const saved = await saveTask(id, me!.key);
        return json({ task: publicTask(saved!) });
      }
      const outcome = await cancelTask(id, me!.key);
      if (outcome === 'notActive') return json({ error: '任务已结束，无法取消' }, 409);
      return json({ task: publicTask((await getTask(id, me!.key))!) });
    }
    if (route === '/api/generate') {
      if (body.privacyConsent !== true) return json({ error: '请先确认图片处理说明' }, 400);
      if (body.safetyConsent !== true) return json({ error: '请先确认非色情用途及图片处理授权' }, 400);
      if (body.serverConsent !== true) return json({ error: '请单独同意将图片提交本站服务器' }, 400);
      if (body.quality !== 'standard' && body.quality !== 'hd') return json({ error: '请选择有效的生成质量' }, 400);
      if (typeof body.idempotencyKey !== 'string' || !UUID_RE.test(body.idempotencyKey)) return json({ error: '幂等键格式无效' }, 400);
      const simulateFailure = body.simulateFailure === true;
      if (body.source === 'upload') {
        // 上传图仍走现有校验;内容审核与真实换装未接入,冻结前直接拒绝(fail closed)。
        if (typeof body.clothingImage !== 'string' || !body.clothingImage.trim()) return json({ error: '请先选择非空白的服装图片' }, 400);
        const day = new Date().toISOString().slice(0, 10);
        if (usage.day !== day) { usage.day = day; usage.count = 0; }
        if (usage.count >= 20) return json({ error: '今日演示次数已用完（每日 20 次）' }, 429);
        usage.count++;
        try {
          await cleanImage(body.clothingImage, true);
          await cleanImage(body.personImage);
        } catch (error) {
          if (error instanceof Error && error.message === 'BLANK_CLOTHING') return json({ error: '服装图片疑似空白、纯色或完全透明，请选择清晰展示衣服的图片' }, 400);
          return json({ error: '请上传可解码的 JPG、PNG 或 WebP 静态图片，每张不超过 5MB，最多 2000 万像素' }, 400);
        }
        return json({ error: '内容审核与真实换装服务尚未接入，已停止处理且未生成图片' }, 503);
      }
      if (body.source !== 'demo') return json({ error: '请选择生成素材来源' }, 400);
      // 演示生成:只用站方内置插画,不触碰任何用户上传内容;计费由服务器账本冻结/结算
      // （demo 内存账本 / production 数据库事务，见 app/server/storage.ts）。
      const submitted = await submitTask(me!.key, { idempotencyKey: body.idempotencyKey, quality: body.quality, simulateFailure });
      if (submitted.kind === 'insufficient') return json({ error: '余额不足，当前余额不足以支付本次生成', credits: await snapshot(me!.key) }, 402);
      if (submitted.kind === 'inProgress') return json({ error: '已有生成任务正在进行，请等待其完成或取消', task: publicTask(submitted.task) }, 409);
      return json({ task: publicTask(submitted.task), credits: await snapshot(me!.key) }, submitted.kind === 'reused' ? 200 : 201);
    }
    if (body.privacyConsent !== true) return json({ error: '请先确认图片处理说明' }, 400);
    if (typeof body.clothingImage !== 'string' || !body.clothingImage.trim()) return json({ error: '请先选择非空白的服装图片' }, 400);
    if (body.safetyConsent !== true) return json({ error: '请先确认非色情用途及图片处理授权' }, 400);
    if (body.serverConsent !== true) return json({ error: '请单独同意将图片提交本站服务器' }, 400);
    const day = new Date().toISOString().slice(0, 10);
    if (usage.day !== day) { usage.day = day; usage.count = 0; }
    if (usage.count >= 20) return json({ error: '今日演示次数已用完（每日 20 次）' }, 429);
    usage.count++;
    if (processing) return json({ error: '已有图片正在处理，请稍后重试' }, 429);
    processing = true;
    try {
      await cleanImage(body.clothingImage, true);
      await cleanImage(body.personImage);
      // Fail closed until a real content review and try-on service is integrated.
      // Client-supplied approvals cannot authorize an unreviewed output.
      return json({ error: '内容审核与真实换装服务尚未接入，已停止处理且未生成图片' }, 503);
    } catch (error) {
      if (error instanceof Error && error.message === 'BLANK_CLOTHING') return json({ error: '服装图片疑似空白、纯色或完全透明，请选择清晰展示衣服的图片' }, 400);
      return json({ error: '请上传可解码的 JPG、PNG 或 WebP 静态图片，每张不超过 5MB，最多 2000 万像素' }, 400);
    } finally { processing = false; }
  } catch {
    return json({ error: '请求格式错误' }, 400);
  }
}
