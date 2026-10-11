// 工作台共享类型。ServerTask 与 app/server/tasks.ts 的 publicTask 字段保持同步——
// 服务端新增字段时需同步更新这里。
export type Kind = 'person' | 'clothing';

export type TaskPhase = 'idle' | 'submitting' | 'resuming' | 'queued' | 'processing' | 'succeeded' | 'failed' | 'cancelled';

export type ServerTask = {
  id: string;
  state: 'queued' | 'processing' | 'succeeded' | 'failed' | 'cancelled';
  quality: 'standard' | 'hd';
  cost: number;
  idempotencyKey: string;
  simulateFailure: boolean;
  saved: boolean;
  createdAt: number;
  updatedAt: number;
  finishedAt: number | null;
  failure: { code: string; message: string } | null;
  hasResult: boolean;
};

export type CreditsView = { balance: number; frozen: number; simulated: true; storage?: 'memory' | 'database' };

export type LedgerEntry = { op: 'freeze' | 'settle' | 'release' | 'restore'; amount: number; ref: string; at: number };

export type StudioResult = { board: string; original: string; server?: boolean; taskId?: string };
