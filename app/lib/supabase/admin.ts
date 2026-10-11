// Supabase Admin 客户端（service_role）：只允许服务端代码调用，绝不导入任何
// 浏览器组件；密钥只放在服务器环境变量（SUPABASE_SERVICE_ROLE_KEY），绝不进
// NEXT_PUBLIC_ 变量、绝不返回给浏览器、绝不写日志。
//
// service_role 绕过 RLS，且是 SQL 中全部 SECURITY DEFINER 函数的唯一授权角色
// （见 docs/supabase-schema.sql）——所有真实 Credits 读写（冻结/结算/释放/对账）
// 与任务事务都经它完成。客户端（anon/authenticated）对账本零写权限。
//
// 安全边界由 tests/security-boundary.test.mjs 扫描兜底：
// 客户端文件不得 import 本模块、不得出现 SUPABASE_SERVICE_ROLE_KEY 字样。
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { resolveAppMode } from '../../server/app-mode';

let client: SupabaseClient | null = null;

export function adminSupabase(): SupabaseClient {
  if (client) return client;
  const mode = resolveAppMode(process.env);
  // 非 production 或配置缺失：直接失败，绝不带着占位密钥发请求、绝不回退 demo。
  if (mode.kind !== 'production') {
    throw new Error('admin client requires APP_MODE=production with complete Supabase configuration');
  }
  client = createClient(mode.url, mode.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

// 仅测试用：清空单例（让后续调用按当前环境重新创建）。
export function __resetAdminClient() { client = null; }
