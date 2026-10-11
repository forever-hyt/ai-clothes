'use client';
// 浏览器 Supabase 客户端（@supabase/ssr）：会话经 Cookie 保存在本站域名下，
// 服务端请求才能读到同一会话（createServerClient + cookies()）。只允许在
// 浏览器组件中调用注册/登录/退出等 auth 操作；Credits 与生成任务一律走
// 服务端 API，浏览器本地永远只是显示，不是账本。
//
// 密钥边界：只读取 NEXT_PUBLIC_ 公开配置（URL 与 publishable key）；
// service_role 密钥绝不进入本文件或任何浏览器代码。
import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

export function browserSupabase(): SupabaseClient {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '';
  // 未配置或仍是模板占位值时抛错：调用方（登录/注册流程）据此提示登录服务
  // 不可用，而不是带着占位配置向不存在的服务发请求。
  if (!url || !key || url.includes('YOUR-PROJECT-REF') || key.includes('YOUR_PUBLISHABLE')) {
    throw new Error('supabase-unconfigured');
  }
  client = createBrowserClient(url, key);
  return client;
}
