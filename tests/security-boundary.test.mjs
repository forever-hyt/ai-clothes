// 安全边界测试：服务端敏感密钥与浏览器代码严格隔离（第 5/11 条要求的静态兜底）。
// 1. 所有带 'use client' 指令的组件/模块：不得导入 supabase/admin（service_role
//    客户端），不得出现 SUPABASE_SERVICE_ROLE_KEY 字样——密钥绝不进浏览器包；
// 2. app/lib/supabase/admin.ts 与服务端存储模块：不得带 'use client' 指令；
// 3. 浏览器客户端 app/lib/supabase/client.ts：只读取 NEXT_PUBLIC_ 公开配置。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const APP_DIR = path.resolve('app');

function walk(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else if (/\.(ts|tsx|mts|cts)$/.test(entry.name)) files.push(full);
  }
  return files;
}

function stripDirective(content) {
  return content.trimStart(); // 同时去掉 BOM（U+FEFF 属于空白字符）
}

const clientFiles = [];
for (const file of walk(APP_DIR)) {
  const content = fs.readFileSync(file, 'utf8');
  const stripped = stripDirective(content);
  if (stripped.startsWith("'use client'") || stripped.startsWith('"use client"')) {
    clientFiles.push({ file, content: stripped });
  }
}

test('客户端文件不得导入 Supabase Admin 模块（service_role 不出浏览器）', () => {
  assert.ok(clientFiles.length > 0, '应至少扫描到带 use client 指令的文件');
  assert.ok(clientFiles.some(({ file }) => file.endsWith('studio-client.tsx')), '编排器应为客户端组件');
  for (const { file, content } of clientFiles) {
    assert.ok(!content.includes('supabase/admin'), `${path.relative('.', file)} 不得导入 supabase/admin`);
  }
});

test('客户端文件不得出现 SUPABASE_SERVICE_ROLE_KEY 字样', () => {
  for (const { file, content } of clientFiles) {
    assert.ok(!content.includes('SUPABASE_SERVICE_ROLE_KEY'), `${path.relative('.', file)} 不得引用 service_role 密钥变量`);
  }
});

test('Admin 客户端与服务端存储模块不得带 use client 指令', () => {
  const admin = stripDirective(fs.readFileSync(path.join(APP_DIR, 'lib/supabase/admin.ts'), 'utf8'));
  assert.ok(!admin.startsWith("'use client'") && !admin.startsWith('"use client"'), 'admin.ts 只能用于服务端');
  for (const name of ['server/storage.ts', 'server/db/credits-db.ts', 'server/db/tasks-db.ts', 'lib/supabase/server.ts']) {
    const content = stripDirective(fs.readFileSync(path.join(APP_DIR, name), 'utf8'));
    assert.ok(!content.startsWith("'use client'") && !content.startsWith('"use client"'), `${name} 只能用于服务端`);
  }
});

test('浏览器客户端只读取 NEXT_PUBLIC_ 公开配置', () => {
  const client = fs.readFileSync(path.join(APP_DIR, 'lib/supabase/client.ts'), 'utf8');
  assert.ok(client.includes('NEXT_PUBLIC_SUPABASE_URL'), '浏览器客户端读取公开 URL');
  assert.ok(client.includes('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'), '浏览器客户端读取 publishable key');
  assert.ok(!client.includes('SUPABASE_SERVICE_ROLE_KEY'), '浏览器客户端不得出现 service_role 密钥变量');
});
