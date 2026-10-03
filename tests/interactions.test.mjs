import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(file, globals = {}) {
  const context = vm.createContext({ exports: {}, ...globals });
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInContext(source, context);
  return context.exports;
}

test('both languages cover the same interface and error keys', () => {
  const { copy } = load('app/studio-copy.ts');
  assert.deepEqual(Object.keys(copy.zh).sort(), Object.keys(copy.en).sort());
  for (const language of ['zh', 'en']) for (const value of Object.values(copy[language])) assert.ok(value.trim());
  assert.match(copy.en.resultNote, /not an AI try-on/);
  assert.match(copy.zh.unavailable, /未开放/);
});

test('uploads reject unsupported, empty, oversized and excessive-pixel images', async () => {
  const api = load('app/studio-images.ts', {
    FileReader: class { readAsDataURL() { this.result = 'data:image/png;base64,test'; this.onload(); } },
    Image: class { naturalWidth = 6000; naturalHeight = 6000; async decode() {} },
  });
  await assert.rejects(api.readMaterial({ type: 'image/svg+xml', size: 100 }), /invalid/);
  await assert.rejects(api.readMaterial({ type: 'image/png', size: 0 }), /invalid/);
  await assert.rejects(api.readMaterial({ type: 'image/png', size: 6 * 1024 * 1024 }), /invalid/);
  await assert.rejects(api.readMaterial({ type: 'image/png', size: 100 }), /pixels/);
});

test('local boards export both sources and a scaled metadata-free portrait', async () => {
  const canvases = [], draws = [];
  const api = load('app/studio-images.ts', {
    Image: class { naturalWidth = 3000; naturalHeight = 4000; async decode() {} },
    document: { createElement() {
      const canvas = { width: 0, height: 0, getContext: () => ({ fillRect() {}, fillText() {}, drawImage(...args) { draws.push(args); } }), toDataURL: type => `data:${type};base64,test` };
      canvases.push(canvas); return canvas;
    } },
  });
  const previews = await api.makePreviews('portrait', 'clothing');
  assert.equal(canvases[0].width, 1200);
  assert.equal(canvases[0].height, 1600);
  assert.equal(canvases[1].width, 1400);
  assert.equal(draws.length, 3);
  assert.equal(draws[1][0].src, 'portrait');
  assert.equal(draws[2][0].src, 'clothing');
  assert.match(previews.board, /^data:image\/png/);
  const samples = api.sampleMaterials();
  assert.ok(samples.person.url.startsWith('data:image/svg+xml'));
  assert.ok(samples.clothing.url.startsWith('data:image/svg+xml'));
  assert.equal(decodeURIComponent(samples.person.url).includes('http://www.w3.org/2000/svg'), true);
});
