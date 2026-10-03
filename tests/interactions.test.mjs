import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function setup() {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      hidden: ['result-output', 'account-menu', 'logout'].includes(id),
      disabled: false, checked: false, value: '', textContent: '', innerHTML: '',
      listeners: {}, classList: { toggle() {}, add() {}, remove() {} },
      addEventListener(name, handler) { this.listeners[name] = handler; },
      setAttribute() {}, removeAttribute(name) { delete this[name]; },
      closest() { return element(`${id}-parent`); },
      querySelector() { return element(`${id}-prompt`); },
      click() { return this.listeners.click?.(); },
      showModal() { this.open = true; },
      close() { this.open = false; this.listeners.close?.(); },
      focus() { this.focused = true; }, scrollIntoView() {},
    });
    return elements.get(id);
  };
  const reads = [], requests = [];
  const context = vm.createContext({
    document: { getElementById: element, addEventListener() {} },
    window: { matchMedia: () => ({ matches: false }) },
    AbortSignal, setInterval() {},
    FileReader: class {
      readAsDataURL() { reads.push(() => { this.result = 'data:image/png;base64,test'; this.onload(); }); }
    },
    Image: class { naturalWidth = 20; naturalHeight = 20; async decode() {} },
    fetch: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, json: async () => ({ user: options ? { username: 'tester' } : null, mode: 'demo', resultUrl: 'data:image/webp;base64,result', remaining: 19, message: '演示' }) };
    },
  });
  vm.runInContext(fs.readFileSync('public/app.js', 'utf8'), context);
  return { element, context, reads, requests, run: code => vm.runInContext(code, context) };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('clearing during image decoding prevents photos reappearing and resets consent', async () => {
  const ui = setup(); await tick();
  const pending = ui.run("choose('person', {type:'image/png', size:100, name:'photo.png'})");
  assert.equal(ui.element('generate').disabled, true);
  assert.equal(ui.element('clear-images').disabled, false);
  ui.element('privacy-consent').checked = true;
  ui.element('clear-images').click();
  ui.reads.shift()(); await pending;
  assert.equal(ui.run('state.person'), null);
  assert.equal(ui.element('privacy-consent').checked, false);
  assert.equal(ui.element('generate').disabled, true);
});

test('login preserves materials and requires an explicit preview click', async () => {
  const ui = setup(); await tick();
  ui.run("state.person = 'person'; state.clothing = 'clothing';");
  ui.element('privacy-consent').checked = true; ui.run('update()');
  assert.equal(ui.element('generate').textContent, '登录后开始演示');
  await ui.element('generate').click();
  assert.equal(ui.element('login-dialog').open, true);
  ui.element('username').value = 'tester'; ui.element('password').value = 'test';
  await ui.element('login-form').listeners.submit({ preventDefault() {} });
  assert.equal(ui.element('password').value, '');
  assert.equal(ui.element('generate').focused, true);
  assert.equal(ui.requests.filter(r => r.url === '/api/try-on').length, 0);
  await ui.element('generate').click();
  assert.equal(ui.element('result-output').hidden, false);
  assert.equal(ui.element('download-result').href, 'data:image/webp;base64,result');
  assert.equal(ui.element('generate').textContent, '重新运行演示');
});

test('preview cannot submit without consent or while replacement is decoding', async () => {
  const ui = setup(); await tick();
  ui.run("state.person = 'person'; state.clothing = 'clothing'; renderUser({username:'tester'});");
  await ui.element('generate').click();
  ui.element('privacy-consent').checked = true;
  const pending = ui.run("choose('person', {type:'image/png', size:100, name:'replacement.png'})");
  await ui.element('generate').click();
  assert.equal(ui.requests.filter(r => r.url === '/api/try-on').length, 0);
  ui.reads.shift()(); await pending;
  assert.equal(ui.element('generate').disabled, false);
});
