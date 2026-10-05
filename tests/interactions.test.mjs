import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
import path from 'node:path';
import { isBlankPixels } from '../app/image-validation.mjs';

function load(file, globals = {}) {
  const context = vm.createContext({ exports: {}, require: createRequire(path.resolve(file)), ...globals });
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


test('expanded wardrobe has unique materials and complete category and season references', () => {
  const { clothes, categories, seasons } = load('app/clothing-catalog.ts');
  assert.equal(clothes.length, 120);
  assert.equal(categories.length, 12);
  assert.equal(new Set(clothes.map(item => item.url)).size, clothes.length);
  assert.equal(new Set(clothes.map(item => item.zh)).size, clothes.length);
  for (const item of clothes) {
    assert.ok(categories.some(row => row[0] === item.category));
    assert.ok(item.zh.trim() && item.en.trim() && item.styleZh.trim() && item.styleEn.trim());
    assert.ok(item.seasons.length);
    for (const season of item.seasons) assert.ok(seasons.some(row => row[0] === season));
    assert.ok(decodeURIComponent(item.url).includes('<svg'));
  }
  for (const [category] of categories) {
    for (const season of ['spring', 'summer', 'autumn', 'winter']) {
      assert.ok(clothes.some(item => item.category === category && item.seasons.includes(season)), `${category} has ${season} clothing`);
    }
  }
});

test('new clothing families use distinct silhouettes and preserve seasonal versatility', () => {
  const { clothes } = load('app/clothing-catalog.ts');
  const shape = name => decodeURIComponent(clothes.find(item => item.zh === name).url).replace(/data-style="[^"]+"/, '').replace(/fill="#[0-9a-f]{6}"/g, 'fill="color"');
  assert.notEqual(shape('针织马甲'), shape('牛仔连体裤'));
  assert.notEqual(shape('改良旗袍'), shape('立领盘扣衬衫'));
  assert.notEqual(shape('缎面晚礼服'), shape('短袖短裤睡衣'));
  assert.ok(clothes.find(item => item.zh === '直筒牛仔裤').seasons.includes('year-round'));
  assert.ok(clothes.find(item => item.zh === '羊毛大衣').seasons.includes('winter'));
});


test('blank checks reject solid colors, invisible RGB and mild noise but accept garment contrast', () => {
  const pixels = (value, count = 128) => Uint8ClampedArray.from(Array.from({ length: count }, (_, index) => value(index)).flat());
  assert.equal(isBlankPixels(new Uint8ClampedArray()), true);
  assert.equal(isBlankPixels(pixels(() => [255, 255, 255, 255])), true);
  assert.equal(isBlankPixels(pixels(() => [255, 0, 0, 255])), true);
  assert.equal(isBlankPixels(pixels(index => [index % 255, 0, 150, 0])), true);
  assert.equal(isBlankPixels(pixels(index => [250 + index % 3, 250, 250, 255])), true);
  assert.equal(isBlankPixels(pixels(index => index < 64 ? [255, 255, 255, 255] : [100, 140, 90, 255])), false);
});

test('clothing uploads reject blank images before returning sanitized local materials', async () => {
  let blank = true;
  const api = load('app/studio-images.ts', {
    FileReader: class { readAsDataURL() { this.result = 'data:image/png;base64,test'; this.onload(); } },
    Image: class { naturalWidth = 128; naturalHeight = 128; async decode() {} },
    document: { createElement() { return {
      getContext: () => ({ drawImage() {}, getImageData: () => ({ data: Uint8ClampedArray.from(blank ? [255,255,255,255,255,255,255,255] : [255,255,255,255,30,100,30,255]) }) }),
      toDataURL: () => 'data:image/webp;base64,c2FuaXRpemVk',
    }; } },
  });
  await assert.rejects(api.readMaterial({ type: 'image/png', size: 20, name: 'blank.png' }, 'clothing'), /blankClothing/);
  blank = false;
  const material = await api.readMaterial({ type: 'image/png', size: 20, name: 'garment.png' }, 'clothing');
  assert.equal(material.url, 'data:image/webp;base64,c2FuaXRpemVk');
  assert.equal(material.source, undefined);
});


test('generation policy blocks missing clothes, missing permissions and all unreviewed uploads', () => {
  const { processingBlock } = load('app/processing-policy.ts');
  const builtin = { url: 'sample', name: 'sample', source: 'builtin' };
  const upload = { url: 'upload', name: 'photo' };
  assert.equal(processingBlock({ person: builtin, clothing: null }, true, true), 'needClothing');
  assert.equal(processingBlock({ person: null, clothing: builtin }, true, true), 'needPerson');
  assert.equal(processingBlock({ person: builtin, clothing: builtin }, false, true), 'needConsent');
  assert.equal(processingBlock({ person: builtin, clothing: builtin }, true, false), 'needSafety');
  assert.equal(processingBlock({ person: upload, clothing: builtin }, true, true), 'moderationUnavailable');
  assert.equal(processingBlock({ person: builtin, clothing: upload }, true, true), 'moderationUnavailable');
  assert.equal(processingBlock({ person: builtin, clothing: builtin }, true, true), null);
});
