// APP_MODE 解析与路由级行为测试：
// - 纯函数 resolveAppMode：demo 默认/显式、production 完整配置、非法值、缺配置、
//   占位符配置与非 URL 一律失败（INVALID_VALUE / MISSING_CONFIG），绝不回退 demo；
// - 路由级：APP_MODE 非法值或 production 缺配置 → GET/POST 一律 503 CONFIG_ERROR；
//   demo 默认行为保持（authMode: 'demo'，未配置登录时 loginAvailable=false）；
// - production + 完整（但不可达）配置：无会话 → 200 未登录（AuthSessionMissingError
//   短路，不发网络请求）；带伪造会话 Cookie → getUser 服务端校验网络失败 →
//   503 DB_UNAVAILABLE（数据库不可用与「未登录」严格区分，绝不伪装、绝不回退）。
//
// route.ts / storage.ts 在模块加载时解析 APP_MODE，且 createServerSupabase /
// adminSupabase 在请求时还会重新解析环境。因此每个场景必须在加载前设置环境、
// 清空 app 目录的模块缓存后重新加载，并保持环境到请求发出之后（loadApi 不恢复）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { patchTsResolution } from './helpers/ts-require.mjs';

// ESM 下访问共享模块缓存（require.cache 与 Module._cache 同一对象）。
const require = createRequire(import.meta.url);

patchTsResolution();

function loadTs(file) {
  const filename = path.resolve(file);
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const loaded = new Module(filename);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded._compile(compiled, filename);
  return loaded.exports;
}

// 纯函数模块（零依赖），独立加载一次。
const { resolveAppMode } = loadTs('app/server/app-mode.ts');

// —— 一、resolveAppMode 纯函数用例 ——

test('resolveAppMode：未设置与 demo 变体默认 demo', () => {
  for (const env of [{}, { APP_MODE: 'demo' }, { APP_MODE: ' DEMO ' }, { APP_MODE: '' }, { APP_MODE: '   ' }, { APP_MODE: undefined }]) {
    assert.deepEqual(resolveAppMode(env), { kind: 'demo' });
  }
});

test('resolveAppMode：非法模式值 → INVALID_VALUE（不回退 demo）', () => {
  for (const value of ['prod', 'Production!', 'productionx', 'staging', 'demo2', 'PRODUCTIONX']) {
    assert.deepEqual(resolveAppMode({ APP_MODE: value }), { kind: 'invalid', reason: 'INVALID_VALUE' }, value);
  }
});

const FULL_CONFIG = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://abcdefgh.supabase.co',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test-only-fake-key',
  SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test-only-fake-key',
};

test('resolveAppMode：production 缺任一配置 → MISSING_CONFIG', () => {
  assert.deepEqual(resolveAppMode({ APP_MODE: 'production' }), { kind: 'invalid', reason: 'MISSING_CONFIG' });
  assert.deepEqual(resolveAppMode({ APP_MODE: 'production', ...FULL_CONFIG, NEXT_PUBLIC_SUPABASE_URL: '' }), { kind: 'invalid', reason: 'MISSING_CONFIG' });
  assert.deepEqual(resolveAppMode({ APP_MODE: 'production', ...FULL_CONFIG, NEXT_PUBLIC_SUPABASE_URL: undefined }), { kind: 'invalid', reason: 'MISSING_CONFIG' });
  assert.deepEqual(resolveAppMode({ APP_MODE: 'production', ...FULL_CONFIG, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: '' }), { kind: 'invalid', reason: 'MISSING_CONFIG' });
  assert.deepEqual(resolveAppMode({ APP_MODE: 'production', ...FULL_CONFIG, SUPABASE_SERVICE_ROLE_KEY: undefined }), { kind: 'invalid', reason: 'MISSING_CONFIG' });
});

test('resolveAppMode：占位符配置或非 URL → MISSING_CONFIG（防止占位密钥上线）', () => {
  assert.deepEqual(resolveAppMode({ APP_MODE: 'production', ...FULL_CONFIG, NEXT_PUBLIC_SUPABASE_URL: 'https://YOUR-PROJECT-REF.supabase.co' }), { kind: 'invalid', reason: 'MISSING_CONFIG' });
  assert.deepEqual(resolveAppMode({ APP_MODE: 'production', ...FULL_CONFIG, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_YOUR_PUBLISHABLE_KEY' }), { kind: 'invalid', reason: 'MISSING_CONFIG' });
  assert.deepEqual(resolveAppMode({ APP_MODE: 'production', ...FULL_CONFIG, SUPABASE_SERVICE_ROLE_KEY: 'YOUR_SERVICE_ROLE_KEY' }), { kind: 'invalid', reason: 'MISSING_CONFIG' });
  assert.deepEqual(resolveAppMode({ APP_MODE: 'production', ...FULL_CONFIG, NEXT_PUBLIC_SUPABASE_URL: 'not-a-url' }), { kind: 'invalid', reason: 'MISSING_CONFIG' });
  assert.deepEqual(resolveAppMode({ APP_MODE: 'production', ...FULL_CONFIG, NEXT_PUBLIC_SUPABASE_URL: 'file:///etc/passwd' }), { kind: 'invalid', reason: 'MISSING_CONFIG' });
});

test('resolveAppMode：完整配置 → production（大小写与首尾空白容忍）', () => {
  assert.deepEqual(resolveAppMode({ APP_MODE: ' PRODUCTION ', ...FULL_CONFIG }), {
    kind: 'production',
    url: FULL_CONFIG.NEXT_PUBLIC_SUPABASE_URL,
    publishableKey: FULL_CONFIG.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    serviceRoleKey: FULL_CONFIG.SUPABASE_SERVICE_ROLE_KEY,
  });
});

// —— 二、路由级用例 ——
// next/headers 的 cookies() 在无请求上下文的测试进程里会抛错；production 场景
// 依赖它读取会话 Cookie，这里注入最小桩（按场景替换 cookieJar）。
const originalLoad = Module._load;
let cookieJar = [];
Module._load = function (request) {
  if (request === 'next/headers') {
    return {
      cookies: async () => ({ getAll: () => cookieJar, set: () => {} }),
    };
  }
  return originalLoad.apply(this, arguments);
};

const APP_DIR_PREFIX = path.resolve('app').replace(/\\/g, '/') + '/';
function clearAppCache() {
  for (const key of Object.keys(require.cache)) {
    if (key.replace(/\\/g, '/').startsWith(APP_DIR_PREFIX)) delete require.cache[key];
  }
}

const MODE_ENV_KEYS = ['APP_MODE', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'LOGIN_USERNAME', 'LOGIN_PASSWORD_HASH'];
const UNREACHABLE_PRODUCTION_ENV = {
  APP_MODE: 'production',
  NEXT_PUBLIC_SUPABASE_URL: 'https://unreachable.invalid',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test-only-fake-key',
  SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test-only-fake-key',
};

// 环境必须在加载前设置且保持到请求之后（请求内还会重新解析 APP_MODE）；
// 各用例自管自设、不做恢复，本文件进程内互不污染。
function loadApi(env) {
  for (const name of MODE_ENV_KEYS) {
    if (env[name] === undefined) delete process.env[name];
    else process.env[name] = env[name];
  }
  clearAppCache();
  return loadTs('app/api/[...segments]/route.ts');
}

const get = (api, pathname, cookie = '') => api.GET(new Request(`https://example.test${pathname}`, { headers: { cookie } }));
const post = (api, route, body) => api.POST(new Request(`https://example.test/api/${route}`, { method: 'POST', headers: { origin: 'https://example.test', 'content-type': 'application/json' }, body: JSON.stringify(body) }));
const generateBody = { privacyConsent: true, safetyConsent: true, serverConsent: true, quality: 'standard', idempotencyKey: crypto.randomUUID(), source: 'demo' };
// 伪造会话 Cookie（与 @supabase/ssr 服务端存储格式一致：原始 JSON，不带 base64-
// 前缀时按原样解析）。getUser 会对 access_token 做服务端校验 → 网络失败 →
// AuthRetryableFetchError，路由据此返回 503 而不是「未登录」。
const fakeSessionCookie = () => ({
  name: 'sb-unreachable-auth-token',
  value: JSON.stringify({
    access_token: 'fake.access.token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: 'fake.refresh.token',
    user: { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', email: 'test@example.invalid', role: 'authenticated', aud: 'authenticated' },
  }),
});

test('路由：APP_MODE 非法值 → GET/POST 一律 503 CONFIG_ERROR', async () => {
  const api = loadApi({ APP_MODE: 'bogus' });
  const me = await get(api, '/api/auth/me');
  assert.equal(me.status, 503);
  assert.equal((await me.json()).code, 'CONFIG_ERROR');
  const generated = await post(api, 'generate', generateBody);
  assert.equal(generated.status, 503);
  assert.equal((await generated.json()).code, 'CONFIG_ERROR');
});

test('路由：APP_MODE=production 但配置缺失 → 503 CONFIG_ERROR，不回退 demo', async () => {
  const api = loadApi({ APP_MODE: 'production' });
  const me = await get(api, '/api/auth/me');
  assert.equal(me.status, 503);
  assert.equal((await me.json()).code, 'CONFIG_ERROR');
  const generated = await post(api, 'generate', generateBody);
  assert.equal(generated.status, 503);
  assert.equal((await generated.json()).code, 'CONFIG_ERROR');
});

test('路由：未设置 APP_MODE → demo 行为保持（authMode demo，未配置登录不可用）', async () => {
  const api = loadApi({}); // 清空模式与登录相关环境
  const me = await get(api, '/api/auth/me');
  assert.equal(me.status, 200);
  assert.deepEqual(await me.json(), { user: null, loginAvailable: false, authMode: 'demo' });
});

test('路由：production + 完整配置 + 无会话 → auth/me 返回未登录（不发网络请求）', async () => {
  cookieJar = [];
  const api = loadApi(UNREACHABLE_PRODUCTION_ENV);
  const me = await get(api, '/api/auth/me');
  assert.equal(me.status, 200);
  assert.deepEqual(await me.json(), { user: null, loginAvailable: true, authMode: 'supabase' });
});

test('路由：production + 数据库不可达 → auth/me 503 DB_UNAVAILABLE（不伪装成未登录）', async () => {
  cookieJar = [fakeSessionCookie()];
  const api = loadApi(UNREACHABLE_PRODUCTION_ENV);
  const me = await get(api, '/api/auth/me');
  assert.equal(me.status, 503);
  const body = await me.json();
  assert.equal(body.code, 'DB_UNAVAILABLE');
  assert.ok(String(body.error).includes('数据库'), '错误文案为中文提示');
});

test('路由：production + 数据库不可达 → POST /api/generate 503 DB_UNAVAILABLE（冻结前即失败）', async () => {
  cookieJar = [fakeSessionCookie()];
  const api = loadApi(UNREACHABLE_PRODUCTION_ENV);
  const generated = await post(api, 'generate', generateBody);
  assert.equal(generated.status, 503);
  assert.equal((await generated.json()).code, 'DB_UNAVAILABLE');
});
