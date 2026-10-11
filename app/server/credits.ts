// 模拟 Credits 账本(受限演示版)。
//
// 重要:当前没有数据库,余额只存在服务器内存中,服务器重启即重置,界面与接口
// 均已明确标注为"演示数据、不涉及真实资金"。所有变更都在单一互斥锁内串行执行,
// 等价于数据库事务的"先检查后变更"语义:冻结(可用余额转入冻结池)、结算(成功
// 后正式扣除)、释放(失败/取消/超时退还)每一步都不可分割,并发下不会重复冻结
// 或超额结算。
//
// 生产环境必须用真实数据库实现同样语义:接口(freeze / settle / release /
// snapshot / recoverOrphans)保持不变,只替换存储。SQL DDL 与事务写法见
// docs/credits-system.md。浏览器本地永远只是显示,不是账本。

export type JournalEntry = { op: 'freeze' | 'settle' | 'release' | 'restore'; amount: number; ref: string; at: number };
type FreezeHold = { amount: number; at: number };
type UserLedger = { balance: number; frozen: number; freezes: Map<string, FreezeHold>; journal: JournalEntry[] };

const JOURNAL_LIMIT = 200;
const globalLedger = globalThis as typeof globalThis & { aiClothesLedger?: Map<string, UserLedger> };
// 挂到 globalThis:dev 模式下路由模块热重载不会清空账本。
const ledgers = globalLedger.aiClothesLedger ??= new Map<string, UserLedger>();

function envInt(name: string, fallback: number) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

export function initialCredits() {
  return envInt('DEMO_CREDITS_INITIAL', 100);
}

// 单一互斥锁:所有账本与任务状态变更串行执行。
let chain: Promise<unknown> = Promise.resolve();
export function locked<T>(run: () => T | Promise<T>): Promise<T> {
  const result = chain.then(run, run);
  chain = result.then(() => undefined, () => undefined);
  return result;
}

function ledger(user: string): UserLedger {
  let entry = ledgers.get(user);
  if (!entry) { entry = { balance: initialCredits(), frozen: 0, freezes: new Map(), journal: [] }; ledgers.set(user, entry); }
  return entry;
}

function push(entry: UserLedger, item: JournalEntry) {
  entry.journal.push(item);
  if (entry.journal.length > JOURNAL_LIMIT) entry.journal.shift();
}

export type CreditsSnapshot = { balance: number; frozen: number; simulated: true };

export function snapshot(user: string): CreditsSnapshot {
  const entry = ledger(user);
  return { balance: entry.balance, frozen: entry.frozen, simulated: true };
}

const LEDGER_VIEW_LIMIT = 50;

// 演示流水视图:快照 + 最近流水(最新在前,上限 50 条),供界面展示对账过程。
export function ledgerView(user: string): CreditsSnapshot & { entries: JournalEntry[] } {
  const entry = ledger(user);
  return {
    balance: entry.balance, frozen: entry.frozen, simulated: true,
    entries: entry.journal.slice(-LEDGER_VIEW_LIMIT).reverse(),
  };
}

// —— 以下 *Now 函数必须在 locked() 临界区内调用,公开的 async 包装会自动加锁 ——

// 冻结:可用余额转入冻结池,ref 用于幂等与对账(生产:UPDATE 余额行带 balance >= amount
// 条件 + INSERT credit_holds 行,同一事务)。
export type FreezeResult = 'ok' | 'insufficient' | 'duplicate';
export function freezeNow(user: string, amount: number, ref: string): FreezeResult {
  const entry = ledger(user);
  if (entry.freezes.has(ref)) return 'duplicate';
  if (entry.balance < amount) return 'insufficient';
  entry.balance -= amount;
  entry.frozen += amount;
  entry.freezes.set(ref, { amount, at: Date.now() });
  push(entry, { op: 'freeze', amount, ref, at: Date.now() });
  return 'ok';
}

// 结算:任务成功且结果已保存后正式扣除(生产:DELETE credit_holds 行 + INSERT credit_ledger
// 流水,同一事务)。
export function settleNow(user: string, ref: string) {
  const entry = ledger(user);
  const hold = entry.freezes.get(ref);
  if (!hold) return;
  entry.frozen -= hold.amount;
  entry.freezes.delete(ref);
  push(entry, { op: 'settle', amount: hold.amount, ref, at: Date.now() });
}

// 释放:任务失败/取消/超时,冻结额度退还可用余额。
export function releaseNow(user: string, ref: string) {
  const entry = ledger(user);
  const hold = entry.freezes.get(ref);
  if (!hold) return;
  entry.balance += hold.amount;
  entry.frozen -= hold.amount;
  entry.freezes.delete(ref);
  push(entry, { op: 'release', amount: hold.amount, ref, at: Date.now() });
}

// 对账:回收所有不属于任何存活任务的孤儿冻结(异常中断的兜底)。
export function recoverOrphansNow(liveRefs: Set<string>): number {
  let restored = 0;
  for (const entry of ledgers.values()) {
    for (const [ref, hold] of entry.freezes) {
      if (liveRefs.has(ref)) continue;
      entry.balance += hold.amount;
      entry.frozen -= hold.amount;
      entry.freezes.delete(ref);
      push(entry, { op: 'restore', amount: hold.amount, ref, at: Date.now() });
      restored++;
    }
  }
  return restored;
}

// —— 公开异步接口(自动加锁) ——
export function freeze(user: string, amount: number, ref: string): Promise<FreezeResult> {
  return locked(() => freezeNow(user, amount, ref));
}
export function settle(user: string, ref: string): Promise<void> {
  return locked(() => settleNow(user, ref));
}
export function release(user: string, ref: string): Promise<void> {
  return locked(() => releaseNow(user, ref));
}
export function recoverOrphans(liveRefs: Set<string>): Promise<number> {
  return locked(() => recoverOrphansNow(liveRefs));
}

// 仅测试用:清空演示账本。
export function __resetLedger() {
  ledgers.clear();
}
