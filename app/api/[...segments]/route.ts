import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import sharp from 'sharp';
import { isBlankPixels } from '../../image-validation.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const TTL = 2 * 60 * 60 * 1000;
const MAX_BODY = 15 * 1024 * 1024;
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
const errorCodes: Record<string, string> = {
  '请先选择非空白的服装图片': 'MISSING_CLOTHING',
  '服装图片疑似空白、纯色或完全透明，请选择清晰展示衣服的图片': 'BLANK_CLOTHING',
  '请先确认非色情用途及图片处理授权': 'SAFETY_CONSENT_REQUIRED',
  '请单独同意将图片提交本站服务器': 'SERVER_CONSENT_REQUIRED',
  '内容审核与真实换装服务尚未接入，已停止处理且未生成图片': 'MODERATION_UNAVAILABLE',
  '管理员尚未配置安全登录账号': 'AUTH_UNAVAILABLE',
  '请先登录，再提交图片': 'AUTH_REQUIRED',
  '用户名或密码错误': 'INVALID_CREDENTIALS',
  '请求来源无效': 'INVALID_ORIGIN',
  '登录尝试过于频繁，请一分钟后重试': 'RATE_LIMITED',
  '请求过于频繁，请一分钟后重试': 'RATE_LIMITED',
  '请先确认图片处理说明': 'CONSENT_REQUIRED',
  '今日演示次数已用完（每日 20 次）': 'QUOTA_EXCEEDED',
  '已有图片正在处理，请稍后重试': 'PROCESSING',
  '请上传可解码的 JPG、PNG 或 WebP 静态图片，每张不超过 5MB，最多 2000 万像素': 'INVALID_IMAGE',
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
export async function GET(request: Request) {
  if (new URL(request.url).pathname !== '/api/auth/me') return json({ error: '接口不存在' }, 404);
  purge();
  return json({ user: sessions.has(token(request)) ? { username, avatar: null } : null, loginAvailable: Boolean(username && hashReady) });
}
export async function POST(request: Request) {
  const route = new URL(request.url).pathname;
  if (!['/api/auth/login', '/api/auth/logout', '/api/try-on'].includes(route)) return json({ error: '接口不存在' }, 404);
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
  if (route === '/api/try-on' && !sessions.has(token(request))) return json({ error: '请先登录，再提交图片' }, 401);
  if (route === '/api/auth/login' && limited('login', 10, 60000)) return json({ error: '登录尝试过于频繁，请一分钟后重试' }, 429);
  if (route === '/api/try-on' && limited('generate', 5, 60000)) return json({ error: '请求过于频繁，请一分钟后重试' }, 429);
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
    if (body.privacyConsent !== true) return json({ error: '请先确认图片处理说明' }, 400);
    if (typeof body.clothingImage !== 'string' || !body.clothingImage.trim()) return json({ error: '请先选择非空白的服装图片' }, 400);
    if (body.safetyConsent !== true) return json({ error: '请先确认非色情用途及图片处理授权' }, 400);
    if (body.serverConsent !== true) return json({ error: '请单独同意将图片提交本站服务器' }, 400);
    const day = new Date().toISOString().slice(0, 10);
    if (usage.day !== day) { usage.day = day; usage.count = 0; }
    if (usage.count >= 20) return json({ error: '今日演示次数已用完（每日 20 次）' }, 429);
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
