// production 模式的 Credits 存储：等价实现 app/server/credits.ts 的接口，但全部
// 读写落在 Supabase PostgreSQL（credit_accounts / credit_ledger），事务语义由
// SQL 的 SECURITY DEFINER 函数提供（一次 rpc = 一个事务，等价 demo 版 locked()
// 临界区）。金额一律 numeric，禁止浮点。
//
// 数据库迁移未执行前，本模块任何调用都会失败并抛 DbUnavailableError（路由层
// 返回 503 DB_UNAVAILABLE）——不会回退内存账本，也不声称真实存储可用。
import { adminSupabase } from '../../lib/supabase/admin';
import { DbUnavailableError } from './errors';
import { profileUsernameCandidates } from './helpers';
import type { CreditsSnapshot, JournalEntry } from '../credits';

type AccountRow = { balance: string | number; frozen: string | number };
type LedgerRow = { op: 'freeze' | 'settle' | 'release' | 'restore'; amount: string | number; ref: string | null; created_at: string };

export type DbCreditsSnapshot = CreditsSnapshot & { storage: 'database' };

function amount(value: string | number): number { return Number(value); }

// 惰性补建 profile 与余额账户（幂等）：auth.users 已存在但 profiles 缺行时
// （例如迁移执行前注册的用户）在首次请求补建。username 先尝试邮箱前缀，
// 撞唯一约束再退到确定性后缀；账户行 upsert 只补建不覆盖余额。
// 表尚未创建（迁移未执行）时同样抛 DbUnavailableError。
export async function ensureProfile(userId: string, email: string): Promise<void> {
  const supabase = adminSupabase();
  const { data: existing, error: selectError } = await supabase.from('profiles').select('id').eq('id', userId).maybeSingle();
  if (selectError) throw new DbUnavailableError(`profiles select: ${selectError.message}`);
  if (existing) return;
  for (const username of profileUsernameCandidates(email, userId)) {
    const { error } = await supabase.from('profiles').insert({ id: userId, username });
    if (!error) break;
    // 撞 username 唯一约束 → 试带后缀的候选；其余一律按数据库不可用处理。
    if (error.code !== '23505') throw new DbUnavailableError(`profiles insert: ${error.message}`);
  }
  const { error: accountError } = await supabase.from('credit_accounts').upsert({ user_id: userId }, { onConflict: 'user_id' });
  if (accountError) throw new DbUnavailableError(`credit_accounts upsert: ${accountError.message}`);
}

export async function snapshot(userId: string): Promise<DbCreditsSnapshot> {
  const supabase = adminSupabase();
  const { data, error } = await supabase.from('credit_accounts').select('balance, frozen').eq('user_id', userId).maybeSingle();
  if (error) throw new DbUnavailableError(`credit_accounts select: ${error.message}`);
  if (!data) return { balance: 0, frozen: 0, simulated: true, storage: 'database' };
  return { balance: amount((data as AccountRow).balance), frozen: amount((data as AccountRow).frozen), simulated: true, storage: 'database' };
}

const LEDGER_VIEW_LIMIT = 50;

export async function ledgerView(userId: string): Promise<DbCreditsSnapshot & { entries: JournalEntry[] }> {
  const supabase = adminSupabase();
  const { data, error } = await supabase.from('credit_ledger')
    .select('op, amount, ref, created_at').eq('user_id', userId)
    .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(LEDGER_VIEW_LIMIT);
  if (error) throw new DbUnavailableError(`credit_ledger select: ${error.message}`);
  const entries: JournalEntry[] = (data ?? []).map(row => ({
    op: (row as LedgerRow).op, amount: amount((row as LedgerRow).amount),
    ref: (row as LedgerRow).ref ?? '', at: Date.parse((row as LedgerRow).created_at),
  }));
  return { ...(await snapshot(userId)), entries };
}
