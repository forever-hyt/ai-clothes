// 演示 Credits 计费与任务全链路测试：冻结→结算、失败/取消/超时释放、
// 幂等键防重复扣费、断线恢复查询(active / by-key)、余额不足不冻结、
// 保存标记、保留期清理、孤儿冻结回收与归属校验。
//
// 加载方式沿 tests/security.test.mjs：ts.transpileModule 转 CJS 后真实 require。
// 环境变量必须在加载 route.ts / tasks.ts 之前设置（对账循环间隔只在模块加载时读取一次）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import { scryptSync } from 'node:crypto';
import ts from 'typescript';
import { patchTsResolution } from './helpers/ts-require.mjs';

patchTsResolution();

process.env.DEMO_RECONCILE_MS = '3600000'; // 消除对账循环对用例的干扰
process.env.DEMO_SIM_QUEUE_MS = '1';
process.env.DEMO_SIM_PROCESS_MS = '1';
process.env.DEMO_CREDITS_INITIAL = '100';
process.env.DEMO_GENERATE_RATE = '1000'; // 用例间共享进程，放宽演示限流
const salt = Buffer.alloc(16, 5);
process.env.LOGIN_USERNAME = 'credits-test';
process.env.LOGIN_PASSWORD_HASH = `${salt.toString('hex')}:${scryptSync('test-password-credits', salt, 64).toString('hex')}`;
process.env.APP_ORIGIN = 'https://example.test';

function loadTs(file) {
  const filename = path.resolve(file);
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const loaded = new Module(filename);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded._compile(compiled, filename);
  return loaded.exports;
}

const api = loadTs('app/api/[...segments]/route.ts');
const tasks = loadTs('app/server/tasks.ts');
const credits = loadTs('app/server/credits.ts');

const post = (route, body, cookie) => api.POST(new Request(`https://example.test/api/${route}`, { method: 'POST', headers: { origin: 'https://example.test', cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) }));
const get = (pathname, cookie) => api.GET(new Request(`https://example.test${pathname}`, { headers: { cookie } }));
const generate = (cookie, extra = {}) => post('generate', { privacyConsent: true, safetyConsent: true, serverConsent: true, quality: 'standard', idempotencyKey: crypto.randomUUID(), source: 'demo', ...extra }, cookie);

async function login() {
  const response = await post('auth/login', { username: 'credits-test', password: 'test-password-credits' }, '');
  assert.equal(response.status, 200);
  return response.headers.get('set-cookie').split(';')[0];
}

async function until(fn, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('until: 等待状态迁移超时');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

test('未登录访问计费与任务接口一律 401', async () => {
  for (const pathname of ['/api/credits/balance', '/api/credits/ledger', '/api/tasks/active', `/api/tasks/by-key/${crypto.randomUUID()}`, `/api/tasks/${'a'.repeat(32)}`]) {
    const response = await get(pathname, '');
    assert.equal(response.status, 401, pathname);
  }
  assert.equal((await post('generate', { privacyConsent: true }, '')).status, 401);
});

test('冻结→结算：成功任务先出结果再扣费，幂等提交不重复冻结', async () => {
  tasks.__resetDemoState();
  const cookie = await login();
  const key = crypto.randomUUID();
  const first = await generate(cookie, { idempotencyKey: key });
  assert.equal(first.status, 201);
  const created = await first.json();
  assert.equal(created.task.state, 'queued');
  assert.equal(created.task.cost, 2);
  assert.deepEqual(created.credits, { balance: 98, frozen: 2, simulated: true });

  // 幂等：同 (user, key) 重复提交返回原任务，不重复冻结。
  const duplicated = await generate(cookie, { idempotencyKey: key });
  assert.equal(duplicated.status, 200);
  const dupData = await duplicated.json();
  assert.equal(dupData.task.id, created.task.id);
  assert.deepEqual(dupData.credits, { balance: 98, frozen: 2, simulated: true });

  // 断线恢复查询：按幂等键找到原任务。
  const byKey = await get(`/api/tasks/by-key/${key}`, cookie);
  assert.equal(byKey.status, 200);
  assert.equal((await byKey.json()).task.id, created.task.id);

  // 未完成时保存 → 409（结果未就绪）。
  const earlySave = await post(`tasks/${created.task.id}/save`, {}, cookie);
  assert.equal(earlySave.status, 409);
  assert.equal((await earlySave.json()).code, 'RESULT_NOT_READY');

  // 等待成功：结果先写入任务记录，随后结算。
  const done = await until(async () => {
    const data = await (await get(`/api/tasks/${created.task.id}`, cookie)).json();
    return data.task.state === 'succeeded' ? data.task : null;
  });
  assert.equal(done.hasResult, true);
  assert.equal(done.failure, null);

  const balance = await (await get('/api/credits/balance', cookie)).json();
  assert.deepEqual(balance, { balance: 98, frozen: 0, simulated: true });

  // 流水：最新在前，结算(ref=task.id) 位于冻结之后。
  const ledger = await (await get('/api/credits/ledger', cookie)).json();
  assert.equal(ledger.entries[0].op, 'settle');
  assert.equal(ledger.entries[0].ref, created.task.id);
  assert.equal(ledger.entries[0].amount, 2);
  assert.ok(ledger.entries.some(entry => entry.op === 'freeze' && entry.ref === created.task.id));

  // 终态后 active 为空。
  assert.equal((await (await get('/api/tasks/active', cookie)).json()).task, null);

  // 结果端点：SVG + CSP sandbox + nosniff；?download=1 触发附件下载。
  const result = await get(`/api/tasks/${created.task.id}/result`, cookie);
  assert.equal(result.status, 200);
  assert.match(result.headers.get('content-type'), /image\/svg\+xml/);
  assert.match(result.headers.get('content-security-policy'), /sandbox/);
  assert.match(result.headers.get('x-content-type-options'), /nosniff/);
  const download = await get(`/api/tasks/${created.task.id}/result?download=1`, cookie);
  assert.match(download.headers.get('content-disposition'), /attachment/);

  // 保存作品：成功任务可标记，且 GET 可见。
  const save = await post(`tasks/${created.task.id}/save`, {}, cookie);
  assert.equal(save.status, 200);
  assert.equal((await save.json()).task.saved, true);
  assert.equal((await (await get(`/api/tasks/${created.task.id}`, cookie)).json()).task.saved, true);
});

test('生成失败：冻结额度自动释放，展示失败原因', async () => {
  tasks.__resetDemoState();
  const cookie = await login();
  const key = crypto.randomUUID();
  const response = await generate(cookie, { idempotencyKey: key, simulateFailure: true });
  assert.equal(response.status, 201);
  const created = await response.json();
  assert.deepEqual(created.credits, { balance: 98, frozen: 2, simulated: true });
  const failed = await until(async () => {
    const data = await (await get(`/api/tasks/${created.task.id}`, cookie)).json();
    return data.task.state === 'failed' ? data.task : null;
  });
  assert.equal(failed.failure.code, 'SIMULATED_PROVIDER_ERROR');
  assert.equal(failed.hasResult, false);
  // 释放：余额回到 100，冻结清零，流水记录 release。
  assert.deepEqual((await (await get('/api/credits/balance', cookie)).json()), { balance: 100, frozen: 0, simulated: true });
  const ledger = await (await get('/api/credits/ledger', cookie)).json();
  assert.equal(ledger.entries[0].op, 'release');
  assert.equal(ledger.entries[0].ref, created.task.id);
  // 失败任务没有结果。
  assert.equal((await get(`/api/tasks/${created.task.id}/result`, cookie)).status, 410);
});

test('余额不足：整体回滚，不冻结、不扣费、不创建任务', async () => {
  process.env.DEMO_CREDITS_INITIAL = '1';
  tasks.__resetDemoState();
  const cookie = await login();
  const response = await generate(cookie, { quality: 'hd' });
  assert.equal(response.status, 402);
  const data = await response.json();
  assert.equal(data.code, 'INSUFFICIENT_CREDITS');
  assert.deepEqual(data.credits, { balance: 1, frozen: 0, simulated: true });
  assert.equal((await (await get('/api/tasks/active', cookie)).json()).task, null);
  assert.equal((await (await get('/api/credits/ledger', cookie)).json()).entries.length, 0);
  process.env.DEMO_CREDITS_INITIAL = '100';
});

test('取消任务：释放冻结，重复取消被拒绝', async () => {
  process.env.DEMO_SIM_QUEUE_MS = '500';
  process.env.DEMO_SIM_PROCESS_MS = '500';
  tasks.__resetDemoState();
  const cookie = await login();
  const created = await (await generate(cookie)).json();
  assert.deepEqual(created.credits, { balance: 98, frozen: 2, simulated: true });
  const cancel = await post(`tasks/${created.task.id}/cancel`, {}, cookie);
  assert.equal(cancel.status, 200);
  assert.equal((await cancel.json()).task.state, 'cancelled');
  assert.deepEqual((await (await get('/api/credits/balance', cookie)).json()), { balance: 100, frozen: 0, simulated: true });
  const again = await post(`tasks/${created.task.id}/cancel`, {}, cookie);
  assert.equal(again.status, 409);
  assert.equal((await again.json()).code, 'TASK_NOT_ACTIVE');
  assert.equal((await get(`/api/tasks/${created.task.id}/result`, cookie)).status, 410);
  process.env.DEMO_SIM_QUEUE_MS = '1';
  process.env.DEMO_SIM_PROCESS_MS = '1';
});

test('同一时间只允许一个活动任务：TASK_IN_PROGRESS 返回进行中的任务', async () => {
  process.env.DEMO_SIM_QUEUE_MS = '300';
  process.env.DEMO_SIM_PROCESS_MS = '300';
  tasks.__resetDemoState();
  const cookie = await login();
  const first = await generate(cookie);
  assert.equal(first.status, 201);
  const firstData = await first.json();
  // 活动任务可通过 /api/tasks/active 恢复。
  const active = await (await get('/api/tasks/active', cookie)).json();
  assert.equal(active.task.id, firstData.task.id);
  assert.deepEqual(active.credits, { balance: 98, frozen: 2, simulated: true });
  // 第二个不同 key 提交 → 409 + 返回进行中的任务（客户端据此恢复进度）。
  const second = await generate(cookie);
  assert.equal(second.status, 409);
  const secondData = await second.json();
  assert.equal(secondData.code, 'TASK_IN_PROGRESS');
  assert.equal(secondData.task.id, firstData.task.id);
  process.env.DEMO_SIM_QUEUE_MS = '1';
  process.env.DEMO_SIM_PROCESS_MS = '1';
});

test('对账：卡住任务超时回收、终态任务保留期清理、孤儿冻结恢复、归属校验', async () => {
  tasks.__resetDemoState();
  const cookie = await login();

  // ① 归属校验：任务只能由所属用户按 id / 幂等键查到。
  const key = crypto.randomUUID();
  const created = await (await generate(cookie, { idempotencyKey: key })).json();
  assert.equal(tasks.getTaskByKey('other-user', key), null);
  assert.equal(tasks.getTask(created.task.id, 'other-user'), null);
  assert.equal(tasks.getTaskByKey('credits-test', key).id, created.task.id);

  // ② 保留期清理：终态任务到期后，任务与 by-key 映射一并删除。
  await until(async () => (await (await get(`/api/tasks/${created.task.id}`, cookie)).json()).task.state === 'succeeded');
  process.env.DEMO_TASK_RETENTION_MS = '1';
  await new Promise(resolve => setTimeout(resolve, 5));
  const pruned = await tasks.reconcileNow();
  assert.equal(pruned.pruned, 1);
  assert.equal((await get(`/api/tasks/${created.task.id}`, cookie)).status, 404);
  assert.equal((await get(`/api/tasks/by-key/${key}`, cookie)).status, 404);
  process.env.DEMO_TASK_RETENTION_MS = String(30 * 60 * 1000);

  // ③ 超时回收：卡在排队中的任务被标记 failed(TIMEOUT) 并释放冻结。
  // ① 的 settle 已永久扣除 2 Credits（余额 98），这里重置演示状态让本场景从 100 开始。
  tasks.__resetDemoState();
  process.env.DEMO_SIM_QUEUE_MS = '60000';
  process.env.DEMO_SIM_PROCESS_MS = '60000';
  const stuck = await (await generate(cookie)).json();
  assert.deepEqual(stuck.credits, { balance: 98, frozen: 2, simulated: true });
  process.env.DEMO_TASK_TIMEOUT_MS = '1';
  await new Promise(resolve => setTimeout(resolve, 5)); // 确保 updatedAt 距今超过 1ms 的超时阈值
  const timedOut = await tasks.reconcileNow();
  assert.equal(timedOut.timedOut, 1);
  const stuckTask = tasks.getTask(stuck.task.id, 'credits-test');
  assert.equal(stuckTask.state, 'failed');
  assert.equal(stuckTask.failure.code, 'TIMEOUT');
  assert.deepEqual((await (await get('/api/credits/balance', cookie)).json()), { balance: 100, frozen: 0, simulated: true });
  process.env.DEMO_TASK_TIMEOUT_MS = String(60 * 1000);
  process.env.DEMO_SIM_QUEUE_MS = '1';
  process.env.DEMO_SIM_PROCESS_MS = '1';

  // ④ 孤儿冻结：不属于任何存活任务的冻结被对账恢复并记录 restore 流水。
  await credits.freeze('credits-test', 5, 'ghost-ref');
  assert.deepEqual(credits.snapshot('credits-test'), { balance: 95, frozen: 5, simulated: true });
  const restored = await tasks.reconcileNow();
  assert.equal(restored.restored, 1);
  assert.deepEqual(credits.snapshot('credits-test'), { balance: 100, frozen: 0, simulated: true });
  const ledger = await (await get('/api/credits/ledger', cookie)).json();
  assert.equal(ledger.entries[0].op, 'restore');
  assert.equal(ledger.entries[0].ref, 'ghost-ref');
});

test('演示限流：超过每分钟次数上限返回 429', async () => {
  tasks.__resetDemoState();
  const cookie = await login();
  process.env.DEMO_GENERATE_RATE = '0'; // 任何提交都超过上限
  const response = await generate(cookie);
  assert.equal(response.status, 429);
  assert.equal((await response.json()).code, 'RATE_LIMITED');
  process.env.DEMO_GENERATE_RATE = '1000';
});
