import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const TTL = 2 * 60 * 60 * 1000;
const MAX_BODY = 15 * 1024 * 1024;
const globalStore = globalThis as typeof globalThis & { tryOnSessions?: Map<string, number> };
const sessions = globalStore.tryOnSessions ??= new Map<string, number>();
const username = process.env.LOGIN_USERNAME || 'admin';
const salt = randomBytes(16);
const hash = scryptSync(process.env.LOGIN_PASSWORD || 'Admin123!', salt, 64);
function token(request: Request) {
  return (request.headers.get('cookie') || '').match(/(?:^|;\s*)session=([a-f0-9]{64})(?:;|$)/)?.[1] || '';
}
function purge() {
  for (const [key, expiry] of sessions) if (expiry <= Date.now()) sessions.delete(key);
}
function json(body: unknown, status = 200, cookie?: string) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...(cookie ? { 'Set-Cookie': cookie } : {}) } });
}
function cookie(value: string, maxAge: number) {
  return `session=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${process.env.COOKIE_SECURE === 'true' ? '; Secure' : ''}`;
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
  return json({ user: sessions.has(token(request)) ? { username, avatar: null } : null });
}
export async function POST(request: Request) {
  const route = new URL(request.url).pathname;
  if (!['/api/auth/login', '/api/auth/logout', '/api/try-on'].includes(route)) return json({ error: '接口不存在' }, 404);
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (origin && origin !== `http://${host}` && origin !== `https://${host}`) return json({ error: '请求来源无效' }, 403);
  if (route === '/api/auth/logout') {
    sessions.delete(token(request));
    return json({ ok: true }, 200, cookie('', 0));
  }
  if (!request.headers.get('content-type')?.startsWith('application/json')) return json({ error: '请求格式错误' }, 415);
  try {
    const reader = request.body?.getReader();
    if (!reader) return json({ error: '请求格式错误' }, 400);
    let size = 0;
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY) { await reader.cancel(); return json({ error: '图片过大，请选择 5MB 以内的图片' }, 413); }
      chunks.push(value);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object') return json({ error: '请求格式错误' }, 400);
    if (route === '/api/auth/login') {
      if (typeof body.username !== 'string' || typeof body.password !== 'string' || body.password.length > 200) return json({ error: '请输入有效的用户名和密码' }, 400);
      const correct = timingSafeEqual(scryptSync(body.password, salt, 64), hash);
      if (!correct || body.username !== username) return json({ error: '用户名或密码错误' }, 401);
      purge(); sessions.delete(token(request));
      const id = randomBytes(32).toString('hex');
      sessions.set(id, Date.now() + TTL);
      return json({ user: { username, avatar: null } }, 200, cookie(id, TTL / 1000));
    }
    if (!validImage(body.personImage) || !validImage(body.clothingImage)) return json({ error: '请上传有效的 JPG、PNG 或 WebP 图片，每张不超过 5MB' }, 400);
    // 接入真正的 AI 提供商后，返回 mode: 'ai' 和生成图片的 resultUrl。
    return json({ mode: 'demo', resultUrl: null, message: '演示流程已完成。真实 AI 模型尚未接入，以下展示上传的人物原图。' });
  } catch {
    return json({ error: '请求格式错误' }, 400);
  }
}
