import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import { scryptSync } from 'node:crypto';
import ts from 'typescript';
import sharp from 'sharp';

test('auth, consent, image validation, metadata removal and rate limits', async () => {
  const salt = Buffer.alloc(16, 9);
  process.env.LOGIN_USERNAME = 'security-test';
  process.env.LOGIN_PASSWORD_HASH = `${salt.toString('hex')}:${scryptSync('test-only-password', salt, 64).toString('hex')}`;
  process.env.APP_ORIGIN = 'https://example.test';
  const filename = path.resolve('app/api/[...segments]/route.ts');
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  const loaded = new Module(filename);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded._compile(compiled, filename);
  const api = loaded.exports;
  const post = (route, body, cookie = '', origin = 'https://example.test') => api.POST(new Request(`https://example.test/api/${route}`, { method: 'POST', headers: { origin, cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) }));
  assert.equal((await post('try-on', {})).status, 401);
  assert.equal((await post('auth/login', {}, '', 'https://evil.test')).status, 403);
  const login = await post('auth/login', { username: 'security-test', password: 'test-only-password' });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  assert.match(login.headers.get('set-cookie'), /HttpOnly/);
  assert.equal((await post('try-on', {}, cookie)).status, 400);
  assert.equal((await post('try-on', { privacyConsent: true, personImage: 'data:image/png;base64,YWJj', clothingImage: 'invalid' }, cookie)).status, 400);
  const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: 'red' } }).jpeg().withMetadata().toBuffer();
  const image = `data:image/jpeg;base64,${bytes.toString('base64')}`;
  const success = await post('try-on', { privacyConsent: true, personImage: image, clothingImage: image }, cookie);
  assert.equal(success.status, 200);
  const data = await success.json();
  const metadata = await sharp(Buffer.from(data.resultUrl.split(',')[1], 'base64')).metadata();
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.format, 'webp');
  assert.equal((await post('try-on', { privacyConsent: true, personImage: image.replace('image/jpeg', 'image/png'), clothingImage: image }, cookie)).status, 400);
  assert.equal((await post('try-on', {}, cookie)).status, 400);
  assert.equal((await post('try-on', {}, cookie)).status, 429);
  await post('auth/logout', {}, cookie);
  assert.equal((await post('try-on', {}, cookie)).status, 401);
});


