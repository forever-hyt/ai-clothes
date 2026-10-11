// 数据库存储的纯函数映射（无 I/O，可独立单元测试，见 tests/db-storage.test.mjs）：
// submit_generation_task 返回文本解析、generation_tasks 行 → Task 对象、
// profiles.username 候选名推导。
//
// Task 形状与 app/server/tasks.ts 的演示任务完全一致，因此路由层与客户端类型
// （app/studio-types.ts 的 ServerTask）无需改动；publicTask 直接复用演示实现。
import { createHash } from 'node:crypto';
import type { Quality } from '../../pricing';
import type { Task, TaskState } from '../tasks';

export type GenerationTaskRow = {
  id: string;
  user_id: string;
  idempotency_key: string;
  quality: string;
  cost: string | number;
  simulate_failure: boolean | null;
  state: string;
  saved: boolean | null;
  failure_code: string | null;
  failure_message: string | null;
  result_svg: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
};

export type SubmitStatus =
  | { kind: 'created' | 'reused' | 'inProgress'; taskId: string }
  | { kind: 'insufficient' }
  | { kind: 'invalid' };

// submit_generation_task 的返回文本（见 docs/supabase-schema.sql）：
// 'created:<id>' | 'reused:<id>' | 'inProgress:<id>' | 'insufficient' | 'invalid'。
export function parseSubmitResult(text: unknown): SubmitStatus {
  const value = typeof text === 'string' ? text : '';
  if (value === 'insufficient') return { kind: 'insufficient' };
  if (value.startsWith('created:')) {
    const taskId = value.slice('created:'.length);
    if (taskId) return { kind: 'created', taskId };
  }
  if (value.startsWith('reused:')) {
    const taskId = value.slice('reused:'.length);
    if (taskId) return { kind: 'reused', taskId };
  }
  if (value.startsWith('inProgress:')) {
    const taskId = value.slice('inProgress:'.length);
    if (taskId) return { kind: 'inProgress', taskId };
  }
  return { kind: 'invalid' };
}

// generation_tasks 行 → Task（时间戳转毫秒 epoch，金额转 number，空值归一）。
export function rowToTask(row: GenerationTaskRow): Task {
  return {
    id: row.id,
    user: row.user_id,
    idempotencyKey: row.idempotency_key,
    quality: (row.quality === 'hd' ? 'hd' : 'standard') as Quality,
    cost: Number(row.cost),
    simulateFailure: row.simulate_failure === true,
    state: row.state as TaskState,
    saved: row.saved === true,
    createdAt: Date.parse(row.created_at),
    updatedAt: Date.parse(row.updated_at),
    finishedAt: row.finished_at ? Date.parse(row.finished_at) : null,
    failure: row.failure_code ? { code: row.failure_code, message: row.failure_message ?? '' } : null,
    result: row.result_svg,
  };
}

// profiles.username 候选名：先试邮箱前缀，撞唯一约束再退到「前缀-短哈希」确定性
// 后缀（与 SQL 触发器/回填同一策略，见 docs/supabase-schema.sql 第 6/12/13 节），
// 同一用户多次重试收敛到同一结果。
export function profileUsernameCandidates(email: string, userId: string): string[] {
  const base = (email.split('@')[0] || '').trim() || 'user';
  const suffix = createHash('md5').update(userId).digest('hex').slice(0, 8);
  return [base, `${base}-${suffix}`];
}
