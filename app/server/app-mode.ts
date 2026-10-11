// APP_MODE 解析（服务端）：demo / production 显式切换，禁止用「Supabase 环境变量
// 是否存在」来猜测模式。
//
// - APP_MODE 未设置或为 demo：demo 模式（内存账本，不连接数据库）。
// - APP_MODE=production：必须同时配置 NEXT_PUBLIC_SUPABASE_URL、
//   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY 与 SUPABASE_SERVICE_ROLE_KEY，
//   缺失、占位值或非法 URL 一律视为配置无效，接口返回 503 CONFIG_ERROR，
//   绝不回退 demo 内存账本。
// - 其它任何值（如 prod、Production 之外的拼写）：同样按无效处理，直接失败。
//
// 纯函数、零依赖，便于单元测试（tests/app-mode.test.mjs）。

export type AppMode =
  | { kind: 'demo' }
  | { kind: 'production'; url: string; publishableKey: string; serviceRoleKey: string }
  | { kind: 'invalid'; reason: 'INVALID_VALUE' | 'MISSING_CONFIG' };

// .env.local 模板中的占位值视为「未配置」，避免 production 模式带着占位符
// 向不存在的服务发请求。
const PLACEHOLDER_MARKS = ['YOUR-PROJECT-REF', 'YOUR_PUBLISHABLE', 'YOUR_SERVICE'];

export function resolveAppMode(env: Record<string, string | undefined>): AppMode {
  const raw = env.APP_MODE;
  if (raw === undefined || raw.trim() === '') return { kind: 'demo' };
  const value = raw.trim().toLowerCase();
  if (value === 'demo') return { kind: 'demo' };
  if (value !== 'production') return { kind: 'invalid', reason: 'INVALID_VALUE' };
  const url = (env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim();
  const publishableKey = (env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '').trim();
  const serviceRoleKey = (env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
  const configured = [url, publishableKey, serviceRoleKey].every(Boolean)
    && ![url, publishableKey, serviceRoleKey].some(value => PLACEHOLDER_MARKS.some(mark => value.includes(mark)))
    && /^https?:\/\/.+/i.test(url);
  if (!configured) return { kind: 'invalid', reason: 'MISSING_CONFIG' };
  return { kind: 'production', url, publishableKey, serviceRoleKey };
}
