// 存储门面：按 APP_MODE 在演示内存实现与 Supabase 数据库实现之间切换。
// 接口与 app/server/credits.ts、app/server/tasks.ts 保持一致——路由层只依赖
// 本模块，这是演示与生产路径的唯一分叉点。
//
// - demo 模式：直接委托内存实现，行为与原先完全一致（重启即重置、单进程）；
// - production 模式：委托数据库实现（SQL 事务），任何数据库故障抛
//   DbUnavailableError，由路由层统一返回 503 DB_UNAVAILABLE，绝不回退内存账本；
// - APP_MODE 为非法值或 production 配置缺失：路由层在入口直接返回
//   503 CONFIG_ERROR，本模块的数据库函数也不会被调用。
import { resolveAppMode } from './app-mode';
import { DbUnavailableError } from './db/errors';
import * as demoCredits from './credits';
import * as demoTasks from './tasks';
import * as dbCredits from './db/credits-db';
import * as dbTasks from './db/tasks-db';
import type { CreditsSnapshot, JournalEntry } from './credits';
import type { SubmitResult, Task } from './tasks';
import type { Quality } from '../pricing';

export { DbUnavailableError };
export type { Task } from './tasks';

// 模块加载时解析一次（环境变量在启动时固定，热更模式变化需重启，文档已注明）。
export const appMode = resolveAppMode(process.env);

const production = appMode.kind === 'production';

export async function snapshot(user: string): Promise<CreditsSnapshot> {
  return production ? dbCredits.snapshot(user) : demoCredits.snapshot(user);
}

export async function ledgerView(user: string): Promise<CreditsSnapshot & { entries: JournalEntry[] }> {
  return production ? dbCredits.ledgerView(user) : demoCredits.ledgerView(user);
}

export async function submitTask(user: string, input: { idempotencyKey: string; quality: Quality; simulateFailure: boolean }): Promise<SubmitResult> {
  return production ? dbTasks.submitTask(user, input) : demoTasks.submitTask(user, input);
}

export async function getTask(id: string, user: string): Promise<Task | null> {
  return production ? dbTasks.getTask(id, user) : demoTasks.getTask(id, user);
}

export async function getActiveTask(user: string): Promise<Task | null> {
  return production ? dbTasks.getActiveTask(user) : demoTasks.getActiveTask(user);
}

export async function getTaskByKey(user: string, idempotencyKey: string): Promise<Task | null> {
  return production ? dbTasks.getTaskByKey(user, idempotencyKey) : demoTasks.getTaskByKey(user, idempotencyKey);
}

export async function cancelTask(id: string, user: string): Promise<'cancelled' | 'notActive' | 'notFound'> {
  return production ? dbTasks.cancelTask(id, user) : demoTasks.cancelTask(id, user);
}

export async function saveTask(id: string, user: string): Promise<Task | null> {
  return production ? dbTasks.saveTask(id, user) : demoTasks.saveTask(id, user);
}

export async function reconcileNow(): Promise<{ timedOut: number; pruned: number; restored: number }> {
  return production ? dbTasks.reconcileNow() : demoTasks.reconcileNow();
}

// 接口返回给浏览器的任务视图（演示与数据库实现共用同一纯函数）。
export function publicTask(task: Task) {
  return demoTasks.publicTask(task);
}
