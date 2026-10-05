import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import { scryptSync } from 'node:crypto';
import ts from 'typescript';
import sharp from 'sharp';

test('auth, consent, image validation, blank rejection, closed review gate and rate limits', async () => {
  const salt = Buffer.alloc(16, 9);
  process.env.LOGIN_USERNAME = 'security-test';
  process.env.LOGIN_PASSWORD_HASH = `${salt.toString('hex')}:${scryptSync('test-only-password', salt, 64).toString('hex')}`;
  process.env.APP_ORIGIN = 'https://example.test/';
  const filename = path.resolve('app/api/[...segments]/route.ts');
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  const loaded = new Module(filename);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded._compile(compiled, filename);
  const api = loaded.exports;
  const available = await (await api.GET(new Request('https://example.test/api/auth/me'))).json();
  assert.equal(available.loginAvailable, true);
  assert.equal(available.user, null);
  assert.equal(JSON.stringify(available).includes(process.env.LOGIN_PASSWORD_HASH), false);
  const post = (route, body, cookie = '', origin = 'https://example.test') => api.POST(new Request(`https://example.test/api/${route}`, { method: 'POST', headers: { origin, cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) }));
  assert.equal((await post('try-on', {})).status, 401);
  assert.equal((await post('auth/login', {}, '', 'https://evil.test')).status, 403);
  const login = await post('auth/login', { username: 'security-test', password: 'test-only-password' });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const current = await api.GET(new Request('https://example.test/api/auth/me', { headers: { cookie } }));
  assert.equal((await current.json()).user.username, 'security-test');
  assert.match(login.headers.get('set-cookie'), /HttpOnly/);
  assert.equal((await post('try-on', {}, cookie)).status, 400);
  assert.equal((await post('try-on', { privacyConsent: true, safetyConsent: true, serverConsent: true, personImage: 'data:image/png;base64,YWJj', clothingImage: 'invalid' }, cookie)).status, 400);
  const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: 'red' } }).jpeg().withMetadata().toBuffer();
  const image = `data:image/jpeg;base64,${bytes.toString('base64')}`;
  const blank = await post('try-on', { privacyConsent: true, safetyConsent: true, serverConsent: true, personImage: image, clothingImage: image }, cookie);
  assert.equal(blank.status, 400);
  assert.equal((await blank.json()).code, 'BLANK_CLOTHING');
  const raw = Buffer.alloc(8 * 8 * 3);
  for (let i = 0; i < raw.length; i += 3) raw[i < raw.length / 2 ? i : i + 2] = 255;
  const valid = await sharp(raw, { raw: { width: 8, height: 8, channels: 3 } }).jpeg().withMetadata().toBuffer();
  const garment = `data:image/jpeg;base64,${valid.toString('base64')}`;
  const stopped = await post('try-on', { privacyConsent: true, safetyConsent: true, serverConsent: true, personImage: image, clothingImage: garment, approved: true, source: 'builtin' }, cookie);
  assert.equal(stopped.status, 503);
  const data = await stopped.json();
  assert.equal(data.code, 'MODERATION_UNAVAILABLE');
  assert.equal(data.resultUrl, undefined);
  assert.match(stopped.headers.get('cache-control'), /no-store/);
  assert.equal((await post('try-on', { privacyConsent: true, safetyConsent: true, serverConsent: true, personImage: image, clothingImage: garment.replace('image/jpeg', 'image/png') }, cookie)).status, 400);
  assert.equal((await post('try-on', {}, cookie)).status, 429);
  await post('auth/logout', {}, cookie);
  assert.equal((await post('try-on', {}, cookie)).status, 401);
});

test('unconfigured login is explicit and does not issue a session', async () => {
  delete process.env.LOGIN_USERNAME;
  delete process.env.LOGIN_PASSWORD_HASH;
  process.env.APP_ORIGIN = 'https://example.test';
  const filename = path.resolve('app/api/[...segments]/route.ts');
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  const loaded = new Module(filename); loaded.filename = filename; loaded.paths = Module._nodeModulePaths(path.dirname(filename)); loaded._compile(compiled, filename);
  const api = loaded.exports;
  const current = await api.GET(new Request('https://example.test/api/auth/me'));
  assert.equal((await current.json()).loginAvailable, false);
  const login = await api.POST(new Request('https://example.test/api/auth/login', { method: 'POST', headers: { origin: 'https://example.test', 'content-type': 'application/json' }, body: JSON.stringify({ username: 'example', password: 'example' }) }));
  assert.equal(login.status, 503);
  assert.equal((await login.json()).code, 'AUTH_UNAVAILABLE');
  assert.equal(login.headers.get('set-cookie'), null);
});




async function protectedApi() {
  const salt = Buffer.alloc(16, 7);
  process.env.LOGIN_USERNAME = 'privacy-test';
  process.env.LOGIN_PASSWORD_HASH = `${salt.toString('hex')}:${scryptSync('test-password-long', salt, 64).toString('hex')}`;
  process.env.APP_ORIGIN = 'https://example.test';
  const filename = path.resolve('app/api/[...segments]/route.ts');
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  const loaded = new Module(filename); loaded.filename = filename; loaded.paths = Module._nodeModulePaths(path.dirname(filename)); loaded._compile(compiled, filename);
  let session = '';
  const post = (route, body) => loaded.exports.POST(new Request(`https://example.test/api/${route}`, { method: 'POST', headers: { origin: 'https://example.test', cookie: session, 'content-type': 'application/json' }, body: JSON.stringify(body) }));
  const login = await post('auth/login', { username: 'privacy-test', password: 'test-password-long' });
  session = login.headers.get('set-cookie').split(';')[0];
  return post;
}

test('server independently requires permitted-use and upload consent and missing clothes stop processing', async () => {
  const post = await protectedApi();
  const base = { privacyConsent: true, clothingImage: 'image', personImage: 'image' };
  for (const value of ['', '   ']) {
    const response = await post('try-on', { ...base, clothingImage: value, safetyConsent: true, serverConsent: true });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, 'MISSING_CLOTHING');
  }
  const safety = await post('try-on', base);
  assert.equal((await safety.json()).code, 'SAFETY_CONSENT_REQUIRED');
  const upload = await post('try-on', { ...base, safetyConsent: true });
  assert.equal((await upload.json()).code, 'SERVER_CONSENT_REQUIRED');
  const local = await post('try-on', { ...base, privacyConsent: false, safetyConsent: true, serverConsent: true });
  assert.equal((await local.json()).code, 'CONSENT_REQUIRED');
});

test('server rejects transparent hidden RGB and blank white or black garment images', async () => {
  const post = await protectedApi();
  for (const background of ['white', 'black', { r: 20, g: 150, b: 220, alpha: 0 }]) {
    const bytes = await sharp({ create: { width: 128, height: 128, channels: 4, background } }).png().toBuffer();
    const image = `data:image/png;base64,${bytes.toString('base64')}`;
    const response = await post('try-on', { privacyConsent: true, safetyConsent: true, serverConsent: true, personImage: image, clothingImage: image });
    assert.equal(response.status, 400);
    const data = await response.json();
    assert.equal(data.code, 'BLANK_CLOTHING');
    assert.equal(data.resultUrl, undefined);
  }
});
