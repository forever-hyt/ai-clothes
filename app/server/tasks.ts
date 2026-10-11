// 生成任务状态机(演示):queued → processing → succeeded | failed | cancelled。
//
// 计费时机:提交时冻结 Credits;只有当结果已写入任务记录(可下载)才在同一个
// 临界区内结算;失败/取消/超时一律释放冻结。幂等键保证同一次提交不会重复生成
// 或重复扣费。completeTask 是"提供方回调"入口,对重复回调幂等(只结算一次)。
// 定时对账处理异常中断:卡住的任务超时回收、孤儿冻结恢复、终态任务到期清理。
//
// 真实服务接入时保留本状态机与计费逻辑,只替换 provider 并把存储换成数据库;
// 生产环境的多实例对账需要外部任务队列,见 docs/credits-system.md。

import { randomBytes } from 'node:crypto';
import { locked, freezeNow, settleNow, releaseNow, recoverOrphansNow, __resetLedger } from './credits';
import { demoProvider, QUALITY_COST, type Quality } from './demo-provider';

export type TaskState = 'queued' | 'processing' | 'succeeded' | 'failed' | 'cancelled';
export type TaskFailure = { code: string; message: string };
export type Task = {
  id: string;
  user: string;
  idempotencyKey: string;
  quality: Quality;
  cost: number;
  simulateFailure: boolean;
  state: TaskState;
  saved: boolean;
  createdAt: number;
  updatedAt: number;
  finishedAt: number | null;
  failure: TaskFailure | null;
  result: string | null; // 演示结果为 SVG 字符串,通过 /api/tasks/<id>/result 提供下载
};

type TaskStore = { tasks: Map<string, Task>; byKey: Map<string, string>; active: Map<string, string> };
const globalTasks = globalThis as typeof globalThis & { aiClothesTasks?: TaskStore };
const store = globalTasks.aiClothesTasks ??= { tasks: new Map(), byKey: new Map(), active: new Map() };

function envInt(name: string, fallback: number) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

export const ACTIVE_STATES: TaskState[] = ['queued', 'processing'];
export const TERMINAL_STATES: TaskState[] = ['succeeded', 'failed', 'cancelled'];

// 演示时长可从环境变量调小,便于测试与演示。
function simQueueMs() { return envInt('DEMO_SIM_QUEUE_MS', 800); }
function simProcessMs() { return envInt('DEMO_SIM_PROCESS_MS', 2500); }

function schedule(task: Task) {
  const advance = setTimeout(() => {
    void locked(() => {
      const current = store.tasks.get(task.id);
      if (!current || current.state !== 'queued') return;
      current.state = 'processing';
      current.updatedAt = Date.now();
    });
  }, simQueueMs());
  const finish = setTimeout(() => { void completeTask(task.id); }, simQueueMs() + simProcessMs());
  advance.unref?.();
  finish.unref?.();
}

export type SubmitResult =
  | { kind: 'created' | 'reused' | 'inProgress'; task: Task }
  | { kind: 'insufficient'; task: null };

// 提交:幂等键(用户, 键)唯一——重复提交返回原任务,不重复冻结;每人同时只有一个
// 活动任务。任务创建与冻结在同一个临界区内完成,余额不足时整体回滚。
export async function submitTask(user: string, input: { idempotencyKey: string; quality: Quality; simulateFailure: boolean }): Promise<SubmitResult> {
  return locked(() => {
    const keyRef = `${user}:${input.idempotencyKey}`;
    const existingId = store.byKey.get(keyRef);
    if (existingId) return { kind: 'reused', task: store.tasks.get(existingId)! };
    const activeId = store.active.get(user);
    if (activeId) return { kind: 'inProgress', task: store.tasks.get(activeId)! };
    const now = Date.now();
    const task: Task = {
      id: randomBytes(16).toString('hex'), user, idempotencyKey: input.idempotencyKey,
      quality: input.quality, cost: QUALITY_COST[input.quality], simulateFailure: input.simulateFailure,
      state: 'queued', saved: false, createdAt: now, updatedAt: now, finishedAt: null, failure: null, result: null,
    };
    const held = freezeNow(user, task.cost, task.id);
    if (held === 'insufficient') return { kind: 'insufficient', task: null };
    // freezeNow 返回 duplicate 不可能发生:任务 id 是全新随机值。
    store.tasks.set(task.id, task);
    store.byKey.set(keyRef, task.id);
    store.active.set(user, task.id);
    schedule(task);
    return { kind: 'created', task };
  });
}

// 提供方回调入口(真实服务接入时由回调/队列调用)。重复回调、超时回收后到达的
// 回调都会被状态检查拦截,冻结只结算或释放一次。provider 抛异常(未按接口约定
// 返回失败结果)也要在此兜底:任务置 failed 并释放冻结,避免挂账等对账超时。
export async function completeTask(id: string): Promise<void> {
  return locked(async () => {
    const task = store.tasks.get(id);
    if (!task || task.state !== 'processing') return;
    const now = Date.now();
    let result: Awaited<ReturnType<typeof demoProvider.run>>;
    try {
      result = await demoProvider.run({ quality: task.quality, simulateFailure: task.simulateFailure });
    } catch {
      task.state = 'failed';
      task.finishedAt = task.updatedAt = now;
      task.failure = { code: 'PROVIDER_ERROR', message: '生成服务内部错误，冻结额度已退还。' };
      releaseNow(task.user, task.id);
      store.active.delete(task.user);
      return;
    }
    task.updatedAt = now;
    if (!result.ok) {
      task.state = 'failed';
      task.finishedAt = now;
      task.failure = { code: result.code, message: result.message };
      releaseNow(task.user, task.id);
      store.active.delete(task.user);
      return;
    }
    // 先保存结果(此后结果可下载),再结算——顺序保证"确认结果保存成功且可下载,
    // 再正式扣除 Credits"。
    task.result = result.svg;
    task.state = 'succeeded';
    task.finishedAt = now;
    settleNow(task.user, task.id);
    store.active.delete(task.user);
  });
}

export function getTask(id: string, user: string): Task | null {
  const task = store.tasks.get(id);
  return task && task.user === user ? task : null;
}

// 当前活动任务(供客户端断网/刷新后恢复进度)。终态或不存在时返回 null。
export function getActiveTask(user: string): Task | null {
  const id = store.active.get(user);
  return id ? getTask(id, user) : null;
}

// 按幂等键查找(供客户端在 POST 响应丢失后确认提交是否已到达服务器)。
export function getTaskByKey(user: string, idempotencyKey: string): Task | null {
  const id = store.byKey.get(`${user}:${idempotencyKey}`);
  return id ? getTask(id, user) : null;
}

// 取消活动任务(撤回同意/清除素材时调用):释放冻结,状态变为 cancelled。
export async function cancelTask(id: string, user: string): Promise<'cancelled' | 'notActive' | 'notFound'> {
  return locked(() => {
    const task = store.tasks.get(id);
    if (!task || task.user !== user) return 'notFound';
    if (ACTIVE_STATES.includes(task.state)) {
      task.state = 'cancelled';
      task.finishedAt = task.updatedAt = Date.now();
      releaseNow(task.user, task.id);
      store.active.delete(task.user);
      return 'cancelled';
    }
    return 'notActive';
  });
}

// 保存作品(演示保存):仅在任务记录上标记,内存保留,随保留期清除。
// 真实持久化需要对象存储/数据库。
export async function saveTask(id: string, user: string): Promise<Task | null> {
  return locked(() => {
    const task = store.tasks.get(id);
    if (!task || task.user !== user) return null;
    if (task.state === 'succeeded') task.saved = true;
    return task;
  });
}

// 对账:① 卡在 queued/processing 超过超时 → failed(TIMEOUT)+ 释放冻结;
// ② 终态任务超过保留期 → 删除任务与结果(契合 30 分钟隐私清理策略);
// ③ 孤儿冻结(有冻结无存活任务)→ 恢复并记录日志。
export async function reconcileNow(): Promise<{ timedOut: number; pruned: number; restored: number }> {
  return locked(() => {
    const now = Date.now();
    const timeoutMs = envInt('DEMO_TASK_TIMEOUT_MS', 60 * 1000);
    const retentionMs = envInt('DEMO_TASK_RETENTION_MS', 30 * 60 * 1000);
    let timedOut = 0;
    let pruned = 0;
    for (const task of store.tasks.values()) {
      if (ACTIVE_STATES.includes(task.state)) {
        if (now - task.updatedAt > timeoutMs) {
          task.state = 'failed';
          task.finishedAt = task.updatedAt = now;
          task.failure = { code: 'TIMEOUT', message: '任务超时,系统已回收冻结额度。' };
          releaseNow(task.user, task.id);
          store.active.delete(task.user);
          timedOut++;
        }
      } else if (now - (task.finishedAt ?? task.updatedAt) > retentionMs) {
        store.tasks.delete(task.id);
        store.byKey.delete(`${task.user}:${task.idempotencyKey}`);
        pruned++;
      }
    }
    const live = new Set<string>();
    for (const task of store.tasks.values()) if (ACTIVE_STATES.includes(task.state)) live.add(task.id);
    const restored = recoverOrphansNow(live);
    if (timedOut || pruned || restored) console.log(`[credits-reconcile] timedOut=${timedOut} pruned=${pruned} restoredFrozen=${restored}`);
    return { timedOut, pruned, restored };
  });
}

// 定期对账循环(演示环境用定时器;生产用独立 worker/队列)。globalThis 防重入:
// dev 热重载不会叠加多个循环。定时器 unref,不阻止进程退出。
const loopFlag = globalThis as typeof globalThis & { aiClothesReconcileLoop?: boolean };
if (!loopFlag.aiClothesReconcileLoop) {
  loopFlag.aiClothesReconcileLoop = true;
  setInterval(() => { void reconcileNow(); }, envInt('DEMO_RECONCILE_MS', 30 * 1000)).unref?.();
}

// 接口返回给浏览器的任务视图:不包含 result 内容(结果经独立端点提供)。
export function publicTask(task: Task) {
  return {
    id: task.id, state: task.state, quality: task.quality, cost: task.cost,
    idempotencyKey: task.idempotencyKey, simulateFailure: task.simulateFailure, saved: task.saved,
    createdAt: task.createdAt, updatedAt: task.updatedAt, finishedAt: task.finishedAt,
    failure: task.failure, hasResult: task.result !== null,
  };
}

// 仅测试用:清空演示任务与账本。
export function __resetDemoState() {
  store.tasks.clear();
  store.byKey.clear();
  store.active.clear();
  __resetLedger();
}
