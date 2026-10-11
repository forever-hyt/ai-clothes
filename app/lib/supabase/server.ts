// 服务端 Supabase 客户端（App Router Route Handler 用）：每个请求新建一个实例，
// 从请求 Cookie 读会话并校验身份（auth.getUser() 会在 token 过期时用 refresh
// token 自动续期）。setAll 把续期后的 Cookie 写回响应（Route Handler 内允许
// 写 Cookie），并附带禁止 CDN 缓存的响应头——本站接口本就统一输出 no-store，
// 与库的建议一致。
//
// 仅服务端使用；非 production 模式（或配置缺失）返回 null，调用方据此拒绝
// 或按模式切换，绝不回退 demo。
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveAppMode } from '../../server/app-mode';

export async function createServerSupabase(): Promise<SupabaseClient | null> {
  const mode = resolveAppMode(process.env);
  if (mode.kind !== 'production') return null;
  const cookieStore = await cookies();
  return createServerClient(mode.url, mode.publishableKey, {
    cookies: {
      getAll() { return cookieStore.getAll(); },
      setAll(cookiesToSet) {
        // 只写 Cookie；缓存响应头由本站接口统一输出（Cache-Control: no-store）。
        for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
      },
    },
  });
}
