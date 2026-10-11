// production 模式的生成任务存储：等价实现 app/server/tasks.ts 的接口，状态机
// 与计费事务由 SQL 函数承担（submit / succeed / fail / cancel / save / reconcile，
// 一次 rpc = 一个事务），本模块负责编排：
//
//  - 提交：生成任务 id（uuid）并调用 submit_generation_task（插入 + 冻结同事务，
//    幂等键与「每人一个活动任务」由数据库唯一索引仲裁）；
//  - 排队/生成时长仍由演示提供方模拟：queued→processing 的转移用 admin 直写并
//    刷新 updated_at（与 SQL 函数注释一致，让对账确认任务仍在执行），随后调用
//    demoProvider 合成演示搭配板；
//  - 提供方完成后调用 succeed / fail（结果先落库再结算/释放，函数内保证顺序）；
//  - 心跳/租约：活动任务每 10 秒刷新一次 updated_at；对账超时阈值（默认 60s）
//    即租约，进程崩溃或热重载丢失定时器后心跳停止 → 租约过期 → 对账回收并
//    退还冻结，绝不误收未完成任务的费用；
//  - 提供方结果先缓存在内存，结算 RPC 失败（数据库瞬时中断）时随心跳重试，
//    succeed/fail 自身幂等（状态检查），可安全重试；
//  - 对账循环（单进程兜底）：每 30 秒调用 reconcile_generation；多实例部署
//    用 SQL 注释里的 pg_cron 调度。
import { randomUUID } from 'node:crypto';
import { adminSupabase } from '../../lib/supabase/admin';
import { DbUnavailableError } from './errors';
import { parseSubmitResult, rowToTask, type GenerationTaskRow } from './helpers';
import { demoProvider, QUALITY_COST, type Quality } from '../demo-provider';
import { ACTIVE_STATES, type SubmitResult, type Task } from '../tasks';

const HEARTBEAT_MS = 10 * 1000; // 心跳间隔：60s 对账超时阈值内至少刷新 5 次
const ACTIVE_STATE_VALUES = ACTIVE_STATES as unknown as string[];

function envInt(name: string, fallback: number) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}
// 排队/生成时长沿用演示变量：生产模式的提供方仍是演示实现（真实换装未接入）。
function simQueueMs() { return envInt('DEMO_SIM_QUEUE_MS', 800); }
function simProcessMs() { return envInt('DEMO_SIM_PROCESS_MS', 2500); }

// 本进程负责推进的活动任务集合（globalThis：dev 热重载共享，避免孤儿定时器）。
const activeFlag = globalThis as typeof globalThis & { aiClothesDbActive?: Set<string> };
const active = activeFlag.aiClothesDbActive ??= new Set<string>();

// 提供方已完成、等待写入数据库的结果（结算 RPC 失败时随心跳重试）。
type PendingOutcome =
  | { kind: 'succeed'; user: string; svg: string }
  | { kind: 'fail'; user: string; code: string; message: string };
const pendingOutcomes = new Map<string, PendingOutcome>();

async function fetchTask(id: string, user: string): Promise<Task | null> {
  const { data, error } = await adminSupabase().from('generation_tasks')
    .select('*').eq('id', id).eq('user_id', user).maybeSingle();
  if (error) throw new DbUnavailableError(`generation_tasks select: ${error.message}`);
  return data ? rowToTask(data as GenerationTaskRow) : null;
}

// 排队 → 处理中：直接写状态并刷新 updated_at，让对账确认「仍在执行」的任务
// 不被误判超时。只有仍处于 queued 的行会被推进（幂等）。
async function advanceToProcessing(id: string): Promise<void> {
  const { error } = await adminSupabase().from('generation_tasks')
    .update({ state: 'processing', updated_at: new Date().toISOString() })
    .eq('id', id).eq('state', 'queued');
  if (error) throw new DbUnavailableError(`advance task: ${error.message}`);
}

// 心跳：刷新活动任务租约 + 重试未写库的提供方结果。心跳失败（数据库中断）
// 只记日志，下一跳重试；若进程死亡，租约过期后由对账回收并退还冻结。
async function heartbeatTick() {
  if (active.size === 0 && pendingOutcomes.size === 0) return;
  const supabase = adminSupabase();
  if (active.size > 0) {
    const { error } = await supabase.from('generation_tasks')
      .update({ updated_at: new Date().toISOString() })
      .in('id', [...active]).in('state', ACTIVE_STATE_VALUES);
    if (error) { console.error(`[db-heartbeat] ${error.message}`); return; }
  }
  for (const [id, outcome] of pendingOutcomes) {
    try {
      if (outcome.kind === 'succeed') await supabase.rpc('succeed_generation_task', { p_user: outcome.user, p_task: id, p_result_svg: outcome.svg });
      else await supabase.rpc('fail_generation_task', { p_user: outcome.user, p_task: id, p_code: outcome.code, p_message: outcome.message });
      pendingOutcomes.delete(id);
    } catch (error) { console.error(`[db-heartbeat] ${error instanceof Error ? error.message : String(error)}`); }
  }
}

// 提供方回调：succeed/fail 只对 processing 状态生效（函数内校验），重复回调、
// 取消或对账回收后的回调都会被状态检查拦截，冻结只结算或释放一次。
export async function completeTask(id: string): Promise<void> {
  let task: Task | null;
  try { task = await fetchTaskById(id); } catch (error) { console.error(`[db-task] ${error instanceof Error ? error.message : String(error)}`); return; }
  active.delete(id);
  if (!task || task.state !== 'processing') return;
  let outcome: Awaited<ReturnType<typeof demoProvider.run>>;
  try {
    outcome = await demoProvider.run({ quality: task.quality, simulateFailure: task.simulateFailure });
  } catch {
    outcome = { ok: false, code: 'PROVIDER_ERROR', message: '生成服务内部错误，冻结额度已退还。' };
  }
  // 先缓存结果再尝试写库：失败时随心跳重试，任务不会被误判超时（租约持续刷新）。
  if (outcome.ok) pendingOutcomes.set(id, { kind: 'succeed', user: task.user, svg: outcome.svg });
  else pendingOutcomes.set(id, { kind: 'fail', user: task.user, code: outcome.code, message: outcome.message });
  await heartbeatTick();
}

async function fetchTaskById(id: string): Promise<Task | null> {
  const { data, error } = await adminSupabase().from('generation_tasks').select('*').eq('id', id).maybeSingle();
  if (error) throw new DbUnavailableError(`generation_tasks select: ${error.message}`);
  return data ? rowToTask(data as GenerationTaskRow) : null;
}

function schedule(task: Task) {
  const advance = setTimeout(() => { void advanceToProcessing(task.id).catch(error => console.error(`[db-task] ${error instanceof Error ? error.message : String(error)}`)); }, simQueueMs());
  const finish = setTimeout(() => { void completeTask(task.id); }, simQueueMs() + simProcessMs());
  advance.unref?.();
  finish.unref?.();
}

const heartbeatFlag = globalThis as typeof globalThis & { aiClothesDbHeartbeat?: boolean };
const reconcileFlag = globalThis as typeof globalThis & { aiClothesDbReconcileLoop?: boolean };

function ensureLoops() {
  if (!heartbeatFlag.aiClothesDbHeartbeat) {
    heartbeatFlag.aiClothesDbHeartbeat = true;
    setInterval(() => { void heartbeatTick(); }, HEARTBEAT_MS).unref?.();
  }
  if (!reconcileFlag.aiClothesDbReconcileLoop) {
    reconcileFlag.aiClothesDbReconcileLoop = true;
    setInterval(() => { void reconcileNow(); }, envInt('RECONCILE_MS', 30 * 1000)).unref?.();
  }
}

// 接续推进（幂等）：任务仍活动且本进程未在推进时，重新启动排队/完成定时器与
// 心跳租约。刷新页面恢复、断线重查、同键重发、重启后首个请求都会经过这里，
// 保证租约不因本进程「旁观」而断档；多进程重复接续由 succeed/fail 的状态
// 检查与行锁保证只结算一次。
function adopt(task: Task) {
  if (!ACTIVE_STATES.includes(task.state) || active.has(task.id)) return;
  active.add(task.id);
  schedule(task);
  ensureLoops();
}

export async function submitTask(user: string, input: { idempotencyKey: string; quality: Quality; simulateFailure: boolean }): Promise<SubmitResult> {
  const id = randomUUID();
  const { data, error } = await adminSupabase().rpc('submit_generation_task', {
    p_user: user, p_id: id, p_idempotency_key: input.idempotencyKey,
    p_quality: input.quality, p_cost: QUALITY_COST[input.quality], p_simulate_failure: input.simulateFailure,
  });
  if (error) throw new DbUnavailableError(`submit_generation_task: ${error.message}`);
  const status = parseSubmitResult(data);
  if (status.kind === 'invalid') throw new DbUnavailableError('submit_generation_task returned invalid');
  if (status.kind === 'insufficient') return { kind: 'insufficient', task: null };
  const task = await fetchTask(status.taskId, user);
  if (!task) throw new DbUnavailableError(`task ${status.taskId} missing after submit`);
  adopt(task);
  return { kind: status.kind, task };
}

export async function getTask(id: string, user: string): Promise<Task | null> {
  const task = await fetchTask(id, user);
  if (task) adopt(task);
  return task;
}

export async function getActiveTask(user: string): Promise<Task | null> {
  const { data, error } = await adminSupabase().from('generation_tasks')
    .select('*').eq('user_id', user).in('state', ACTIVE_STATE_VALUES).maybeSingle();
  if (error) throw new DbUnavailableError(`generation_tasks select: ${error.message}`);
  const task = data ? rowToTask(data as GenerationTaskRow) : null;
  if (task) adopt(task);
  return task;
}

export async function getTaskByKey(user: string, idempotencyKey: string): Promise<Task | null> {
  const { data, error } = await adminSupabase().from('generation_tasks')
    .select('*').eq('user_id', user).eq('idempotency_key', idempotencyKey).maybeSingle();
  if (error) throw new DbUnavailableError(`generation_tasks select: ${error.message}`);
  const task = data ? rowToTask(data as GenerationTaskRow) : null;
  if (task) adopt(task);
  return task;
}

export async function cancelTask(id: string, user: string): Promise<'cancelled' | 'notActive' | 'notFound'> {
  const { data, error } = await adminSupabase().rpc('cancel_generation_task', { p_user: user, p_task: id });
  if (error) throw new DbUnavailableError(`cancel_generation_task: ${error.message}`);
  active.delete(id);
  return data === 'cancelled' || data === 'notActive' || data === 'notFound' ? data : 'notFound';
}

export async function saveTask(id: string, user: string): Promise<Task | null> {
  const { error } = await adminSupabase().rpc('save_generation_task', { p_user: user, p_task: id });
  if (error) throw new DbUnavailableError(`save_generation_task: ${error.message}`);
  return fetchTask(id, user);
}

// 对账（等价 demo 版 reconcileNow）：超时回收 + 保留期清理 + 孤儿冻结恢复，
// 事务与防误释放语义在 SQL 内实现。RPC 失败时只记日志并返回零计数——路由层
// 不需要对账结果，下一轮循环重试。
export async function reconcileNow(): Promise<{ timedOut: number; pruned: number; restored: number }> {
  try {
    const { data, error } = await adminSupabase().rpc('reconcile_generation', {});
    if (error) throw new DbUnavailableError(`reconcile_generation: ${error.message}`);
    const result = data as { timedOut?: number | string; pruned?: number | string; restored?: number | string } | null;
    return { timedOut: Number(result?.timedOut ?? 0), pruned: Number(result?.pruned ?? 0), restored: Number(result?.restored ?? 0) };
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') console.error(`[db-reconcile] ${error instanceof Error ? error.message : String(error)}`);
    return { timedOut: 0, pruned: 0, restored: 0 };
  }
}
