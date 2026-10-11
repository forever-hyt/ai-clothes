// 数据库存储接口测试：
// - 纯函数（无 I/O）：submit_generation_task 返回文本解析、generation_tasks 行 →
//   Task 映射、profiles.username 候选名推导（确定性、重试收敛）；
// - 存储门面（APP_MODE=production + 不可达数据库）：任何读/写一律抛
//   DbUnavailableError——production 模式数据库不可用必须失败，绝不回退内存账本；
//   对账 RPC 失败只记日志并返回零计数（不抛、不阻塞请求）。
//
// storage.ts 在模块加载时解析 APP_MODE，环境必须在加载前设置。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { patchTsResolution } from './helpers/ts-require.mjs';

patchTsResolution();

// 不可达域名（.invalid 按 RFC 保留，保证解析失败、离线可用）：任何数据库
// 调用都会在网络上失败，用于验证「失败封闭」保证。
process.env.APP_MODE = 'production';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://unreachable.invalid';
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test-only-fake-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test-only-fake-key';
process.env.DEMO_RECONCILE_MS = '3600000'; // 演示/数据库对账循环不进测试窗口
process.env.RECONCILE_MS = '3600000';

function loadTs(file) {
  const filename = path.resolve(file);
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const loaded = new Module(filename);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded._compile(compiled, filename);
  return loaded.exports;
}

const helpers = loadTs('app/server/db/helpers.ts');
const storage = loadTs('app/server/storage.ts');
const USER = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const KEY = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

// —— 一、纯函数映射 ——

test('parseSubmitResult：SQL 函数返回文本全部变体', () => {
  assert.deepEqual(helpers.parseSubmitResult('created:11111111-1111-1111-1111-111111111111'), { kind: 'created', taskId: '11111111-1111-1111-1111-111111111111' });
  assert.deepEqual(helpers.parseSubmitResult('reused:11111111-1111-1111-1111-111111111111'), { kind: 'reused', taskId: '11111111-1111-1111-1111-111111111111' });
  assert.deepEqual(helpers.parseSubmitResult('inProgress:11111111-1111-1111-1111-111111111111'), { kind: 'inProgress', taskId: '11111111-1111-1111-1111-111111111111' });
  assert.deepEqual(helpers.parseSubmitResult('insufficient'), { kind: 'insufficient' });
  for (const value of ['created:', 'reused:', 'inProgress:', 'unknown:x', '', null, undefined, 42, {}]) {
    assert.deepEqual(helpers.parseSubmitResult(value), { kind: 'invalid' }, String(value));
  }
});

test('rowToTask：行 → Task 全字段映射与归一化', () => {
  const base = {
    id: 'task-1', user_id: USER, idempotency_key: KEY, quality: 'hd', cost: '5',
    simulate_failure: true, state: 'processing', saved: true,
    failure_code: null, failure_message: null, result_svg: null,
    created_at: '2026-10-10T00:00:00.000Z', updated_at: '2026-10-10T00:00:01.500Z', finished_at: null,
  };
  const task = helpers.rowToTask(base);
  assert.equal(task.id, 'task-1');
  assert.equal(task.user, USER);
  assert.equal(task.idempotencyKey, KEY);
  assert.equal(task.quality, 'hd');
  assert.equal(task.cost, 5); // 字符串金额 → number
  assert.equal(task.simulateFailure, true);
  assert.equal(task.state, 'processing');
  assert.equal(task.saved, true);
  assert.equal(task.failure, null);
  assert.equal(task.result, null);
  assert.equal(task.createdAt, Date.parse(base.created_at));
  assert.equal(task.updatedAt, Date.parse(base.updated_at));
  assert.equal(task.finishedAt, null);

  const failed = helpers.rowToTask({
    ...base, quality: 'standard', cost: 2, simulate_failure: null, state: 'failed', saved: null,
    failure_code: 'PROVIDER_ERROR', failure_message: 'boom', finished_at: '2026-10-10T00:00:02.000Z',
  });
  assert.equal(failed.quality, 'standard');
  assert.equal(failed.cost, 2);
  assert.equal(failed.simulateFailure, false);
  assert.equal(failed.saved, false);
  assert.equal(failed.failure.code, 'PROVIDER_ERROR');
  assert.equal(failed.failure.message, 'boom');
  assert.equal(failed.finishedAt, Date.parse('2026-10-10T00:00:02.000Z'));
});

test('profileUsernameCandidates：确定性候选名（重试收敛，撞唯一约束退后缀）', () => {
  const [first, second] = helpers.profileUsernameCandidates('alice@example.com', 'user-id-1');
  assert.equal(first, 'alice');
  assert.match(second, /^alice-[0-9a-f]{8}$/);
  // 同一用户重试收敛到同一候选（与 SQL 触发器/回填策略一致）。
  assert.deepEqual(helpers.profileUsernameCandidates('alice@example.com', 'user-id-1'), [first, second]);
  // 不同用户后缀不同（md5(userId) 前 8 位）。
  const [, other] = helpers.profileUsernameCandidates('alice@example.com', 'user-id-2');
  assert.notEqual(other, second);
  // 空邮箱回退 'user'。
  const [fallback, fallbackSuffixed] = helpers.profileUsernameCandidates('', 'u');
  assert.equal(fallback, 'user');
  assert.match(fallbackSuffixed, /^user-[0-9a-f]{8}$/);
  assert.equal(helpers.profileUsernameCandidates('  @example.com', 'u')[0], 'user');
});

// —— 二、存储门面：production + 数据库不可达 → 失败封闭 ——

test('门面：APP_MODE=production 被正确解析', () => {
  assert.equal(storage.appMode.kind, 'production');
  assert.equal(storage.appMode.url, 'https://unreachable.invalid');
});

test('门面：数据库不可达 → 读路径一律 DbUnavailableError（绝不回退内存账本）', async () => {
  await assert.rejects(storage.snapshot(USER), storage.DbUnavailableError);
  await assert.rejects(storage.ledgerView(USER), storage.DbUnavailableError);
  await assert.rejects(storage.getActiveTask(USER), storage.DbUnavailableError);
  await assert.rejects(storage.getTask(KEY, USER), storage.DbUnavailableError);
  await assert.rejects(storage.getTaskByKey(USER, KEY), storage.DbUnavailableError);
});

test('门面：数据库不可达 → 写路径一律 DbUnavailableError（冻结/取消/保存均不落账）', async () => {
  await assert.rejects(storage.submitTask(USER, { idempotencyKey: KEY, quality: 'standard', simulateFailure: false }), storage.DbUnavailableError);
  await assert.rejects(storage.cancelTask(KEY, USER), storage.DbUnavailableError);
  await assert.rejects(storage.saveTask(KEY, USER), storage.DbUnavailableError);
});

test('门面：对账 RPC 不可达 → 只记日志并返回零计数（不抛、不阻塞）', async () => {
  assert.deepEqual(await storage.reconcileNow(), { timedOut: 0, pruned: 0, restored: 0 });
});
