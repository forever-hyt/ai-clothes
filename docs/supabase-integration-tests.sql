-- ============================================================================
-- AI Clothes · Supabase PostgreSQL 集成测试（docs/supabase-integration-tests.sql）
-- 版本：v1.2（与 docs/supabase-schema.sql v2.2 配套）
--
-- 覆盖（对应迁移前终审要求与独立审查发现的全部条目）：
--   冻结→结算（先结果后扣费、重复结算幂等）· 失败→释放 · 取消→释放 ·
--   重复提交（同键重发/重放不重复冻结）· 并发语义（settle XOR release）·
--   租约/心跳边界（59s 不回收 / 61s 回收，长任务在租约内绝不误收）·
--   孤儿冻结：恢复/结算/释放并发互斥（两种先后顺序单会话验证；双会话真实
--   竞态为附录 A/B 待验证项）· succeed 缺冻结记录必须 RAISE 回滚（任务不
--   落地 succeeded）· 余额不足零副作用 · 参数校验（NULL/超大金额/非法质量/
--   非法状态零副作用）· 事务中断（数据库断连模拟：子事务回滚后零残留、重试
--   安全）· 注册回填完整性（历史用户缺资料补建、撞名修复循环、零遗漏断言）·
--   触发器建号（profiles + 100 演示余额）。
--
-- 执行前提：docs/supabase-schema.sql v2.2 已执行且第 14 节自检通过。
-- 隔离环境要求（重要）：第 11 节会运行与迁移第 13 节一致的全量回填。请优先
--   在隔离测试环境运行——专用测试项目、Supabase Preview Branch 或本地
--   supabase CLI 容器，不要在生产项目上运行。第 11 节自带防护：检测到回填将
--   向非测试用户写入数据时直接报错终止。本文件不再禁用注册触发器（改用
--   删除测试用户触发建号的行来构造「缺资料」状态），对并发注册零影响；其余
--   各节只操作 itest-* 测试用户，不触碰其他数据。
-- 事务边界（本文件自带，不依赖执行工具是否自动包事务）：第 0 节助手函数之后
--   是 begin;，第 12 节清理之后是 commit;——整份测试一个事务，失败即整体
--   回滚、零残留。
--   · psql（推荐）：psql -v ON_ERROR_STOP=1 -f docs/supabase-integration-tests.sql "<连接串>"
--     ——不要加 --single-transaction（文件已自带 begin/commit）。失败时
--     ON_ERROR_STOP 使 psql 停在未完成的事务上：执行 rollback; 即恢复干净
--     （关闭连接也会自动回滚）。
--   · SQL Editor：若编辑器把全文包成一个事务，文件中的 begin 只会告警
--     （无害）、末尾 commit 会提交编辑器事务（其后无任何语句，同样无害）；
--     若编辑器逐语句执行，则由文件自带的 begin/commit 保证整体回滚。两种
--     情形下失败都零残留。
-- 安全声明：只增删本文件自建的测试用户（邮箱 itest-*@example.invalid，经
--   auth.users → profiles 级联清理全部业务数据）；无 DROP、无 TRUNCATE、
--   不触碰任何真实业务数据（第 11 节的回填只补缺行且有非测试用户防护）。
--   若执行中途被强制中断留下残留，应急清理：
--     delete from auth.users where email like 'itest-%@example.invalid';
--
-- 调用方说明：SQL Editor 以 postgres 执行。业务函数 SECURITY DEFINER 以属主
--   postgres 运行，行为与服务器经 service_role 调用完全一致；参数名与
--   app/server/db/* 的 rpc 调用一一对应（p_user/p_task/p_idempotency_key/…）。
--   queued→processing 的转移由服务器 admin 直写（tasks-db.ts 的
--   advanceToProcessing），测试中以同样语句模拟。
--   若本项目策略禁止直接写 auth.users：改用面板 Authentication → Users 手动
--   建号（邮箱用下方 itest-u1…u8、itest-backfill@… 字样），并把第 1 节与
--   第 11 节的 INSERT 换成：
--     insert into test_users (name, id)
--     select 'u1', id from auth.users where email = 'itest-u1@example.invalid';
--   其余测试不变（第 11 节的「缺资料用户」改用面板建号后手工删除其
--   profiles 行来等价模拟，本文件正是这么做的）。
-- ============================================================================

-- 0) 断言助手（pg_temp：会话级临时对象，随连接结束自动消失）
create or replace function pg_temp.assert_true(cond boolean, label text)
returns void language plpgsql as $$
begin
  if cond is not true then
    raise exception '断言失败：%', label;
  end if;
end $$;

-- 事务边界：整份测试一个事务（失败即整体回滚、零残留）。若执行工具已包了
-- 外层事务，这里的 begin 只会告警（无害）、末尾 commit 会提交外层事务
-- （其后无任何语句，同样无害）；若执行工具逐语句自动提交，则由此处开始、
-- 由末尾 commit 结束——两种情形下行为都正确（详见文件头「事务边界」）。
begin;

-- 1) 准备：创建 8 个测试用户。直接写 auth.users 会触发 handle_new_auth_user，
--    一举验证触发器授权与建号逻辑（profiles 行 + 100 演示余额账户）。
--    注：auth.users 的 NOT NULL 列随 Supabase 版本略有差异，若此处报 NOT NULL
--    违例，按报错补列即可（或改用上面的面板建号方案）。
--    同会话重跑兼容：先清掉上次运行残留的临时表。
drop table if exists pg_temp.test_users;
create temp table test_users (name text primary key, id uuid not null)
  on commit preserve rows;

with new_users as (
  insert into auth.users
    (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
     created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values
    ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'itest-u1@example.invalid', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
    ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'itest-u2@example.invalid', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
    ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'itest-u3@example.invalid', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
    ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'itest-u4@example.invalid', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
    ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'itest-u5@example.invalid', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
    ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'itest-u6@example.invalid', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
    ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'itest-u7@example.invalid', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
    ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'itest-u8@example.invalid', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}')
  returning id, email
)
insert into test_users (name, id)
select case email
         when 'itest-u1@example.invalid' then 'u1'
         when 'itest-u2@example.invalid' then 'u2'
         when 'itest-u3@example.invalid' then 'u3'
         when 'itest-u4@example.invalid' then 'u4'
         when 'itest-u5@example.invalid' then 'u5'
         when 'itest-u6@example.invalid' then 'u6'
         when 'itest-u7@example.invalid' then 'u7'
         else 'u8' end, id
from new_users;

do $$
declare v_cnt integer;
begin
  select count(*) into v_cnt from public.profiles p
   join test_users u on u.id = p.id;
  perform pg_temp.assert_true(v_cnt = 8, '触发器未为全部测试用户建立 profiles 行');

  select count(*) into v_cnt from public.credit_accounts a
   join test_users u on u.id = a.user_id
   where a.balance = 100 and a.frozen = 0;
  perform pg_temp.assert_true(v_cnt = 8, '触发器未建立 100 演示余额账户');

  raise notice 'PASS：触发器建号（profiles + 100 演示余额，supabase_auth_admin 授权路径在真实注册时验证）';
end $$;

-- ============================================================================
-- 2) 冻结→结算（u1）：提交即冻结；结果先落库、settle 才发生；重复结算被拦截
-- ============================================================================
do $$
declare
  v_u uuid; v_cnt integer;
  v_task text := 'itest-task-settle-' || gen_random_uuid()::text;
  v_key text := 'itest-key-settle-' || gen_random_uuid()::text;
  v_r text; v_ok boolean; v_balance numeric; v_frozen numeric;
begin
  select id into v_u from test_users where name = 'u1';

  v_r := public.submit_generation_task(v_u, v_task, v_key, 'standard', 2, false);
  perform pg_temp.assert_true(v_r = 'created:' || v_task, 'submit 应返回 created（实际：' || v_r || '）');

  select balance, frozen into v_balance, v_frozen
    from public.credit_accounts where user_id = v_u;
  perform pg_temp.assert_true(v_balance = 98 and v_frozen = 2,
    '冻结后余额应为 98/2（实际 ' || v_balance || '/' || v_frozen || '）');
  select count(*) into v_cnt from public.credit_holds where user_id = v_u and task_id = v_task;
  perform pg_temp.assert_true(v_cnt = 1, '应恰有一笔冻结明细');
  select count(*) into v_cnt from public.credit_ledger
   where user_id = v_u and ref = v_task and op = 'freeze';
  perform pg_temp.assert_true(v_cnt = 1, 'freeze 流水应恰一条');

  -- 模拟服务器 advanceToProcessing（admin 直写，与 tasks-db.ts 一致）
  update public.generation_tasks
     set state = 'processing', updated_at = now()
   where id = v_task and state = 'queued';

  v_ok := public.succeed_generation_task(v_u, v_task, '<svg>ok</svg>');
  perform pg_temp.assert_true(v_ok, 'succeed 应返回 true');

  select balance, frozen into v_balance, v_frozen
    from public.credit_accounts where user_id = v_u;
  perform pg_temp.assert_true(v_balance = 98 and v_frozen = 0,
    '结算后余额应为 98/0（实际 ' || v_balance || '/' || v_frozen || '）');
  select count(*) into v_cnt from public.credit_holds where user_id = v_u and task_id = v_task;
  perform pg_temp.assert_true(v_cnt = 0, '结算后冻结明细应删除');
  select count(*) into v_cnt from public.credit_ledger
   where user_id = v_u and ref = v_task and op = 'settle';
  perform pg_temp.assert_true(v_cnt = 1, 'settle 流水应恰一条');
  select count(*) into v_cnt from public.generation_tasks
   where id = v_task and state = 'succeeded' and result_svg = '<svg>ok</svg>';
  perform pg_temp.assert_true(v_cnt = 1, '任务应 succeeded 且结果已落库');

  -- 重复结算被拦截（对应服务器心跳重试 succeed 的路径）
  v_ok := public.succeed_generation_task(v_u, v_task, '<svg>again</svg>');
  perform pg_temp.assert_true(not v_ok, '重复 succeed 应返回 false');
  select count(*) into v_cnt from public.credit_ledger
   where user_id = v_u and ref = v_task and op = 'settle';
  perform pg_temp.assert_true(v_cnt = 1, '重复结算不得再记流水');

  raise notice 'PASS：冻结→结算（先结果后扣费，重复结算幂等）';
end $$;

-- ============================================================================
-- 3) 重复提交（u2）：同键换新任务 id 重发 → reused 原任务；同键同 id 重放 →
--    reused；全程只冻结一次
-- ============================================================================
do $$
declare
  v_u uuid; v_cnt integer;
  v_key text := 'itest-key-dup-' || gen_random_uuid()::text;
  v_t1 text := 'itest-task-dup1-' || gen_random_uuid()::text;
  v_t2 text := 'itest-task-dup2-' || gen_random_uuid()::text;
  v_r text; v_balance numeric; v_frozen numeric;
begin
  select id into v_u from test_users where name = 'u2';

  v_r := public.submit_generation_task(v_u, v_t1, v_key, 'standard', 2, false);
  perform pg_temp.assert_true(v_r = 'created:' || v_t1, '首次提交应 created（实际：' || v_r || '）');

  v_r := public.submit_generation_task(v_u, v_t2, v_key, 'standard', 2, false);
  perform pg_temp.assert_true(v_r = 'reused:' || v_t1, '同键重发应 reused 原任务（实际：' || v_r || '）');

  v_r := public.submit_generation_task(v_u, v_t1, v_key, 'standard', 2, false);
  perform pg_temp.assert_true(v_r = 'reused:' || v_t1, '同键同 id 重放应 reused（实际：' || v_r || '）');

  select balance, frozen into v_balance, v_frozen
    from public.credit_accounts where user_id = v_u;
  perform pg_temp.assert_true(v_balance = 98 and v_frozen = 2,
    '重复提交只应冻结一次（实际 ' || v_balance || '/' || v_frozen || '）');
  select count(*) into v_cnt from public.generation_tasks
   where user_id = v_u and idempotency_key = v_key;
  perform pg_temp.assert_true(v_cnt = 1, '同键只应存在一个任务');
  select count(*) into v_cnt from public.credit_holds where user_id = v_u;
  perform pg_temp.assert_true(v_cnt = 1, '只应有一笔冻结明细');
  select count(*) into v_cnt from public.credit_ledger
   where user_id = v_u and op = 'freeze';
  perform pg_temp.assert_true(v_cnt = 1, 'freeze 流水只应有一条');

  raise notice 'PASS：重复提交幂等（同键重发/重放不重复冻结）';
end $$;

-- ============================================================================
-- 4) 失败→释放（u3）：processing 失败释放冻结；重复 fail / fail 后 succeed
--    均被状态检查拦截
-- ============================================================================
do $$
declare
  v_u uuid; v_cnt integer;
  v_task text := 'itest-task-fail-' || gen_random_uuid()::text;
  v_key text := 'itest-key-fail-' || gen_random_uuid()::text;
  v_r text; v_ok boolean; v_balance numeric; v_frozen numeric;
begin
  select id into v_u from test_users where name = 'u3';

  v_r := public.submit_generation_task(v_u, v_task, v_key, 'standard', 2, true);
  perform pg_temp.assert_true(v_r = 'created:' || v_task, 'submit 应返回 created（实际：' || v_r || '）');

  update public.generation_tasks
     set state = 'processing', updated_at = now()
   where id = v_task and state = 'queued';

  v_ok := public.fail_generation_task(v_u, v_task, 'SIMULATED_PROVIDER_ERROR', '模拟提供方失败');
  perform pg_temp.assert_true(v_ok, 'fail 应返回 true');

  select balance, frozen into v_balance, v_frozen
    from public.credit_accounts where user_id = v_u;
  perform pg_temp.assert_true(v_balance = 100 and v_frozen = 0,
    '失败释放后余额应回到 100/0（实际 ' || v_balance || '/' || v_frozen || '）');
  select count(*) into v_cnt from public.credit_holds where user_id = v_u;
  perform pg_temp.assert_true(v_cnt = 0, '失败后冻结明细应删除');
  select count(*) into v_cnt from public.credit_ledger
   where user_id = v_u and ref = v_task and op = 'release';
  perform pg_temp.assert_true(v_cnt = 1, 'release 流水应恰一条');
  select count(*) into v_cnt from public.generation_tasks
   where id = v_task and state = 'failed' and failure_code = 'SIMULATED_PROVIDER_ERROR';
  perform pg_temp.assert_true(v_cnt = 1, '任务应 failed 且记录失败码');

  v_ok := public.fail_generation_task(v_u, v_task, 'X', 'again');
  perform pg_temp.assert_true(not v_ok, '重复 fail 应返回 false');
  v_ok := public.succeed_generation_task(v_u, v_task, '<svg>late</svg>');
  perform pg_temp.assert_true(not v_ok, 'failed 后 succeed 应返回 false');
  select count(*) into v_cnt from public.credit_ledger
   where user_id = v_u and ref = v_task and op = 'settle';
  perform pg_temp.assert_true(v_cnt = 0, 'failed 任务不得出现 settle 流水');

  raise notice 'PASS：失败→释放（重复回调幂等，failed 后不得结算）';
end $$;

-- ============================================================================
-- 5) 取消→释放（u4）：queued 即取消；重复取消 notActive；他人任务 notFound
-- ============================================================================
do $$
declare
  v_u uuid; v_other uuid; v_cnt integer;
  v_task text := 'itest-task-cancel-' || gen_random_uuid()::text;
  v_key text := 'itest-key-cancel-' || gen_random_uuid()::text;
  v_r text; v_balance numeric; v_frozen numeric;
begin
  select id into v_u from test_users where name = 'u4';
  select id into v_other from test_users where name = 'u1';

  v_r := public.submit_generation_task(v_u, v_task, v_key, 'standard', 2, false);
  perform pg_temp.assert_true(v_r = 'created:' || v_task, 'submit 应返回 created（实际：' || v_r || '）');

  v_r := public.cancel_generation_task(v_u, v_task);
  perform pg_temp.assert_true(v_r = 'cancelled', 'queued 取消应返回 cancelled（实际：' || v_r || '）');

  select balance, frozen into v_balance, v_frozen
    from public.credit_accounts where user_id = v_u;
  perform pg_temp.assert_true(v_balance = 100 and v_frozen = 0,
    '取消释放后余额应回到 100/0（实际 ' || v_balance || '/' || v_frozen || '）');
  select count(*) into v_cnt from public.credit_ledger
   where user_id = v_u and ref = v_task and op = 'release';
  perform pg_temp.assert_true(v_cnt = 1, '取消应记一条 release 流水');
  select count(*) into v_cnt from public.generation_tasks
   where id = v_task and state = 'cancelled';
  perform pg_temp.assert_true(v_cnt = 1, '任务应 cancelled');

  v_r := public.cancel_generation_task(v_u, v_task);
  perform pg_temp.assert_true(v_r = 'notActive', '重复取消应返回 notActive（实际：' || v_r || '）');
  v_r := public.cancel_generation_task(v_other, v_task);
  perform pg_temp.assert_true(v_r = 'notFound', '他人任务应返回 notFound（实际：' || v_r || '）');
  v_r := public.cancel_generation_task(v_u, 'itest-task-ghost-' || gen_random_uuid()::text);
  perform pg_temp.assert_true(v_r = 'notFound', '不存在任务应返回 notFound（实际：' || v_r || '）');

  raise notice 'PASS：取消→释放（重复取消/越权取消/不存在任务均安全）';
end $$;

-- ============================================================================
-- 6) 并发语义（u5，单会话确定性交错）：succeed 与 cancel 对同一任务只可能
--    发生其一——先结算后取消 → 不释放；先取消后结算 → 不结算
-- ============================================================================
do $$
declare
  v_u uuid; v_cnt integer;
  v_a text := 'itest-task-race1-' || gen_random_uuid()::text;
  v_b text := 'itest-task-race2-' || gen_random_uuid()::text;
  v_ka text := 'itest-key-race1-' || gen_random_uuid()::text;
  v_kb text := 'itest-key-race2-' || gen_random_uuid()::text;
  v_r text; v_ok boolean; v_balance numeric; v_frozen numeric;
begin
  select id into v_u from test_users where name = 'u5';

  -- 6a：先 succeed 后 cancel
  v_r := public.submit_generation_task(v_u, v_a, v_ka, 'standard', 2, false);
  perform pg_temp.assert_true(v_r = 'created:' || v_a, 'A 提交失败（实际：' || v_r || '）');
  update public.generation_tasks set state = 'processing', updated_at = now()
   where id = v_a and state = 'queued';
  v_ok := public.succeed_generation_task(v_u, v_a, '<svg>a</svg>');
  perform pg_temp.assert_true(v_ok, 'A succeed 应返回 true');
  v_r := public.cancel_generation_task(v_u, v_a);
  perform pg_temp.assert_true(v_r = 'notActive', 'succeeded 后取消应 notActive（实际：' || v_r || '）');

  -- 6b：先 cancel 后 succeed
  v_r := public.submit_generation_task(v_u, v_b, v_kb, 'standard', 2, false);
  perform pg_temp.assert_true(v_r = 'created:' || v_b, 'B 提交失败（实际：' || v_r || '）');
  update public.generation_tasks set state = 'processing', updated_at = now()
   where id = v_b and state = 'queued';
  v_r := public.cancel_generation_task(v_u, v_b);
  perform pg_temp.assert_true(v_r = 'cancelled', 'processing 取消应 cancelled（实际：' || v_r || '）');
  v_ok := public.succeed_generation_task(v_u, v_b, '<svg>b</svg>');
  perform pg_temp.assert_true(not v_ok, 'cancelled 后 succeed 应返回 false');

  -- 不变量：每个任务 settle 与 release 恰发生其一，账目最终一致
  select count(*) into v_cnt from public.credit_ledger
   where user_id = v_u and ref = v_a and op = 'settle';
  perform pg_temp.assert_true(v_cnt = 1, 'A 应恰有一条 settle 流水');
  select count(*) into v_cnt from public.credit_ledger
   where user_id = v_u and ref = v_a and op = 'release';
  perform pg_temp.assert_true(v_cnt = 0, 'A 不得出现 release 流水');
  select count(*) into v_cnt from public.credit_ledger
   where user_id = v_u and ref = v_b and op = 'release';
  perform pg_temp.assert_true(v_cnt = 1, 'B 应恰有一条 release 流水');
  select count(*) into v_cnt from public.credit_ledger
   where user_id = v_u and ref = v_b and op = 'settle';
  perform pg_temp.assert_true(v_cnt = 0, 'B 不得出现 settle 流水');

  -- 账目复核：A 结算净扣 2（100→98）；B 冻结 2 后取消退还 2（净零，98→98）。
  --   两任务只结算了 A，最终应为 98/0，不是 96/0。
  select balance, frozen into v_balance, v_frozen
    from public.credit_accounts where user_id = v_u;
  perform pg_temp.assert_true(v_balance = 98 and v_frozen = 0,
    'A 结算 -2、B 取消退还 +2，余额应为 98/0（实际 ' || v_balance || '/' || v_frozen || '）');
  select count(*) into v_cnt from public.credit_holds where user_id = v_u;
  perform pg_temp.assert_true(v_cnt = 0, '不得残留冻结明细');

  raise notice 'PASS：并发语义（succeed 与 cancel 只可能发生其一，账目一致）';
end $$;

-- ============================================================================
-- 7) 租约/心跳边界（u6）：租约（60s）内的长任务绝不误回收；过期才回收退费；
--    保留期清理。心跳每 10s 刷新 updated_at，本测试回拨时间戳等价模拟
--    「最后一次心跳距今」的各种边界。
-- ============================================================================
do $$
declare
  v_u uuid; v_cnt integer;
  v_a text := 'itest-task-timeout-' || gen_random_uuid()::text;
  v_c text := 'itest-task-fresh-' || gen_random_uuid()::text;
  v_ka text := 'itest-key-timeout-' || gen_random_uuid()::text;
  v_kc text := 'itest-key-fresh-' || gen_random_uuid()::text;
  v_r text; v_ok boolean; v_result jsonb;
  v_balance numeric; v_frozen numeric; v_state text;
begin
  select id into v_u from test_users where name = 'u6';

  -- A：租约临界内（59s）不得回收
  v_r := public.submit_generation_task(v_u, v_a, v_ka, 'standard', 2, false);
  perform pg_temp.assert_true(v_r = 'created:' || v_a, 'A 提交失败（实际：' || v_r || '）');
  update public.generation_tasks
     set updated_at = now() - interval '59 seconds'
   where id = v_a;
  v_result := public.reconcile_generation(60000, 1800000);
  perform pg_temp.assert_true((v_result->>'timedOut')::int = 0,
    '租约内（59s）不得回收（实际：' || v_result || '）');
  select state into v_state from public.generation_tasks where id = v_a;
  perform pg_temp.assert_true(v_state = 'queued', 'A 应保持 queued（实际：' || v_state || '）');
  select balance, frozen into v_balance, v_frozen
    from public.credit_accounts where user_id = v_u;
  perform pg_temp.assert_true(v_balance = 98 and v_frozen = 2,
    '未回收时账目不得变动（实际 ' || v_balance || '/' || v_frozen || '）');

  -- A：租约过期（61s）→ 回收退费
  update public.generation_tasks
     set updated_at = now() - interval '61 seconds'
   where id = v_a;
  v_result := public.reconcile_generation(60000, 1800000);
  perform pg_temp.assert_true((v_result->>'timedOut')::int = 1,
    '租约过期应回收 1 个任务（实际：' || v_result || '）');
  perform pg_temp.assert_true((v_result->>'restored')::int = 0, '不应误恢复冻结');
  select state into v_state from public.generation_tasks where id = v_a;
  perform pg_temp.assert_true(v_state = 'failed', '超时任务应 failed（实际：' || v_state || '）');
  select count(*) into v_cnt from public.generation_tasks
   where id = v_a and failure_code = 'TIMEOUT';
  perform pg_temp.assert_true(v_cnt = 1, '超时任务应标记 TIMEOUT');
  select count(*) into v_cnt from public.credit_ledger
   where user_id = v_u and ref = v_a and op = 'release';
  perform pg_temp.assert_true(v_cnt = 1, '超时回收应退费（release 流水）');
  select balance, frozen into v_balance, v_frozen
    from public.credit_accounts where user_id = v_u;
  perform pg_temp.assert_true(v_balance = 100 and v_frozen = 0,
    '超时退费后余额应回到 100/0（实际 ' || v_balance || '/' || v_frozen || '）');

  -- C：心跳持续刷新（30s 内）→ 不回收
  v_r := public.submit_generation_task(v_u, v_c, v_kc, 'standard', 2, false);
  perform pg_temp.assert_true(v_r = 'created:' || v_c, 'C 提交失败（实际：' || v_r || '）');
  update public.generation_tasks
     set updated_at = now() - interval '30 seconds'
   where id = v_c;
  v_result := public.reconcile_generation(60000, 1800000);
  perform pg_temp.assert_true((v_result->>'timedOut')::int = 0,
    '心跳间隔内（30s）不得回收（实际：' || v_result || '）');
  select state into v_state from public.generation_tasks where id = v_c;
  perform pg_temp.assert_true(v_state = 'queued', 'C 应保持 queued（实际：' || v_state || '）');

  -- C：长时间任务（processing + 租约内 59s）→ 不误回收
  update public.generation_tasks set state = 'processing', updated_at = now()
   where id = v_c and state = 'queued';
  update public.generation_tasks
     set updated_at = now() - interval '59 seconds'
   where id = v_c;
  v_result := public.reconcile_generation(60000, 1800000);
  perform pg_temp.assert_true((v_result->>'timedOut')::int = 0,
    '长任务在租约内不得误回收（实际：' || v_result || '）');
  select state into v_state from public.generation_tasks where id = v_c;
  perform pg_temp.assert_true(v_state = 'processing', 'C 应保持 processing（实际：' || v_state || '）');

  -- C：正常完成，随后用极短保留期验证保留期清理
  v_ok := public.succeed_generation_task(v_u, v_c, '<svg>c</svg>');
  perform pg_temp.assert_true(v_ok, 'C succeed 应返回 true');
  update public.generation_tasks
     set finished_at = now() - interval '2 seconds'
   where id = v_c;
  v_result := public.reconcile_generation(60000, 1);
  perform pg_temp.assert_true((v_result->>'pruned')::int >= 1,
    '保留期清理应至少清掉 1 个终态任务（实际：' || v_result || '）');
  select count(*) into v_cnt from public.generation_tasks where id = v_c;
  perform pg_temp.assert_true(v_cnt = 0, '过期终态任务应被清理');

  select balance, frozen into v_balance, v_frozen
    from public.credit_accounts where user_id = v_u;
  perform pg_temp.assert_true(v_balance = 98 and v_frozen = 0,
    'C 结算后余额应为 98/0（实际 ' || v_balance || '/' || v_frozen || '）');

  raise notice 'PASS：租约/心跳边界（59s 不回收、61s 回收、长任务在租约内绝不误收）';
end $$;

-- ============================================================================
-- 8) 孤儿冻结（u7）：恢复/结算/释放并发互斥（两种先后顺序）· 引用活动任务的
--    冻结绝不误释放 · succeed 缺冻结记录必须 RAISE 回滚
-- ============================================================================
do $$
declare
  v_u uuid; v_cnt integer;
  v_d text := 'itest-task-orphan-' || gen_random_uuid()::text;
  v_kd text := 'itest-key-orphan-' || gen_random_uuid()::text;
  v_g1 text := 'itest-ghost1-' || gen_random_uuid()::text;
  v_g2 text := 'itest-ghost2-' || gen_random_uuid()::text;
  v_s text := 'itest-task-missing-hold-' || gen_random_uuid()::text;
  v_ks text := 'itest-key-missing-hold-' || gen_random_uuid()::text;
  v_r text; v_ok boolean; v_raised boolean; v_result jsonb;
  v_balance numeric; v_frozen numeric; v_state text;
begin
  select id into v_u from test_users where name = 'u7';

  -- D：正常活动任务（queued），其冻结必须保留
  v_r := public.submit_generation_task(v_u, v_d, v_kd, 'standard', 2, false);
  perform pg_temp.assert_true(v_r = 'created:' || v_d, 'D 提交失败（实际：' || v_r || '）');

  -- 8a：restore 先于 settle（同一孤儿冻结只可能被处理一次）
  insert into public.credit_holds (user_id, task_id, amount) values (v_u, v_g1, 5);
  update public.credit_accounts set frozen = frozen + 5 where user_id = v_u;

  v_result := public.reconcile_generation(60000, 1800000);
  perform pg_temp.assert_true((v_result->>'restored')::int = 1,
    '应恢复 1 笔孤儿冻结（实际：' || v_result || '）');
  perform pg_temp.assert_true((v_result->>'timedOut')::int = 0, '不应误判超时');
  v_ok := public.settle_credits(v_u, v_g1);
  perform pg_temp.assert_true(not v_ok, 'restore 之后 settle 不得再结算同一冻结');
  select count(*) into v_cnt from public.credit_ledger
   where user_id = v_u and ref = v_g1 and op = 'restore';
  perform pg_temp.assert_true(v_cnt = 1, 'g1 应恰有一条 restore 流水');
  select count(*) into v_cnt from public.credit_ledger
   where user_id = v_u and ref = v_g1 and op = 'settle';
  perform pg_temp.assert_true(v_cnt = 0, 'g1 不得出现 settle 流水（防重复更新余额）');

  select balance, frozen into v_balance, v_frozen
    from public.credit_accounts where user_id = v_u;
  perform pg_temp.assert_true(v_balance = 103 and v_frozen = 2,
    'restore 后余额应为 103/2（实际 ' || v_balance || '/' || v_frozen || '）');

  -- 8b：settle 先于 restore（对称顺序，同样只处理一次）
  insert into public.credit_holds (user_id, task_id, amount) values (v_u, v_g2, 3);
  update public.credit_accounts set frozen = frozen + 3 where user_id = v_u;

  v_ok := public.settle_credits(v_u, v_g2);
  perform pg_temp.assert_true(v_ok, 'settle 应先于 restore 结算该冻结');
  v_result := public.reconcile_generation(60000, 1800000);
  perform pg_temp.assert_true((v_result->>'restored')::int = 0,
    'settle 之后 restore 不得再恢复同一冻结（实际：' || v_result || '）');
  select count(*) into v_cnt from public.credit_ledger
   where user_id = v_u and ref = v_g2 and op = 'settle';
  perform pg_temp.assert_true(v_cnt = 1, 'g2 应恰有一条 settle 流水');
  select count(*) into v_cnt from public.credit_ledger
   where user_id = v_u and ref = v_g2 and op = 'restore';
  perform pg_temp.assert_true(v_cnt = 0, 'g2 不得出现 restore 流水（防重复更新余额）');

  select balance, frozen into v_balance, v_frozen
    from public.credit_accounts where user_id = v_u;
  perform pg_temp.assert_true(v_balance = 103 and v_frozen = 2,
    'settle 后余额应为 103/2（实际 ' || v_balance || '/' || v_frozen || '）');

  -- D 的冻结与状态全程不受影响
  select count(*) into v_cnt from public.credit_holds where task_id = v_d;
  perform pg_temp.assert_true(v_cnt = 1, '活动任务的冻结明细必须保留');
  select state into v_state from public.generation_tasks where id = v_d;
  perform pg_temp.assert_true(v_state = 'queued', '活动任务应保持 queued（实际：' || v_state || '）');

  -- succeed 缺冻结记录 → 必须 RAISE 回滚，任务不落地 succeeded（审查问题 2）
  v_r := public.submit_generation_task(v_u, v_s, v_ks, 'standard', 2, false);
  perform pg_temp.assert_true(v_r = 'created:' || v_s, 'S 提交失败（实际：' || v_r || '）');
  -- 模拟冻结记录已被孤儿恢复消费（对账兜底路径）：手工删除冻结并退回冻结池
  delete from public.credit_holds where task_id = v_s;
  update public.credit_accounts set frozen = frozen - 2 where user_id = v_u;
  update public.generation_tasks set state = 'processing', updated_at = now()
   where id = v_s and state = 'queued';

  v_raised := false;
  begin
    perform public.succeed_generation_task(v_u, v_s, '<svg>s</svg>');
  exception when others then
    v_raised := true;   -- succeed 因缺冻结记录 RAISE → 子事务回滚其全部写入
  end;
  perform pg_temp.assert_true(v_raised, '缺冻结记录时 succeed 必须 RAISE（不得静默返回 true）');
  select state into v_state from public.generation_tasks where id = v_s;
  perform pg_temp.assert_true(v_state = 'processing',
    'RAISE 回滚后任务必须保持 processing（实际：' || v_state || '）');
  select count(*) into v_cnt from public.generation_tasks
   where id = v_s and result_svg is not null;
  perform pg_temp.assert_true(v_cnt = 0, '回滚后不得残留结果内容');
  select count(*) into v_cnt from public.credit_ledger
   where user_id = v_u and ref = v_s and op = 'settle';
  perform pg_temp.assert_true(v_cnt = 0, '缺冻结记录不得出现 settle 流水');
  select balance, frozen into v_balance, v_frozen
    from public.credit_accounts where user_id = v_u;
  perform pg_temp.assert_true(v_balance = 101 and v_frozen = 2,
    'RAISE 回滚后余额应为 101/2（实际 ' || v_balance || '/' || v_frozen || '）');

  raise notice 'PASS：孤儿冻结并发互斥 + succeed 缺冻结记录 RAISE 回滚';
end $$;

-- ============================================================================
-- 9) 参数校验与非法状态（u8）：NULL/超大金额/非法质量/非法状态一律零副作用
-- ============================================================================
do $$
declare
  v_u uuid; v_cnt integer;
  v_task text := 'itest-task-guard-' || gen_random_uuid()::text;
  v_key text := 'itest-key-guard-' || gen_random_uuid()::text;
  v_r text; v_ok boolean; v_balance numeric; v_frozen numeric; v_state text;
begin
  select id into v_u from test_users where name = 'u8';

  -- 参数校验：全部拒绝且零副作用
  v_r := public.submit_generation_task(null, v_task, v_key, 'standard', 2, false);
  perform pg_temp.assert_true(v_r = 'invalid', 'NULL 用户应返回 invalid（实际：' || v_r || '）');
  v_r := public.submit_generation_task(v_u, null, v_key, 'standard', 2, false);
  perform pg_temp.assert_true(v_r = 'invalid', 'NULL 任务 id 应返回 invalid（实际：' || v_r || '）');
  v_r := public.submit_generation_task(v_u, v_task, null, 'standard', 2, false);
  perform pg_temp.assert_true(v_r = 'invalid', 'NULL 幂等键应返回 invalid（实际：' || v_r || '）');
  v_r := public.submit_generation_task(v_u, v_task, v_key, null, 2, false);
  perform pg_temp.assert_true(v_r = 'invalid', 'NULL 质量应返回 invalid（实际：' || v_r || '）');
  v_r := public.submit_generation_task(v_u, v_task, v_key, 'ultra', 2, false);
  perform pg_temp.assert_true(v_r = 'invalid', '非法质量应返回 invalid（实际：' || v_r || '）');
  v_r := public.submit_generation_task(v_u, v_task, v_key, 'standard', null, false);
  perform pg_temp.assert_true(v_r = 'invalid', 'NULL 消耗应返回 invalid（实际：' || v_r || '）');
  v_r := public.submit_generation_task(v_u, v_task, v_key, 'standard', 0, false);
  perform pg_temp.assert_true(v_r = 'invalid', '零消耗应返回 invalid（实际：' || v_r || '）');
  v_r := public.submit_generation_task(v_u, v_task, v_key, 'standard', 10000000000, false);
  perform pg_temp.assert_true(v_r = 'invalid', '超大金额（超 numeric(12,2) 容量）应返回 invalid（实际：' || v_r || '）');

  select count(*) into v_cnt from public.generation_tasks where user_id = v_u;
  perform pg_temp.assert_true(v_cnt = 0, '非法参数不得创建任务');
  select count(*) into v_cnt from public.credit_holds where user_id = v_u;
  perform pg_temp.assert_true(v_cnt = 0, '非法参数不得冻结');
  select count(*) into v_cnt from public.credit_ledger where user_id = v_u;
  perform pg_temp.assert_true(v_cnt = 0, '非法参数不得记流水');
  select balance, frozen into v_balance, v_frozen
    from public.credit_accounts where user_id = v_u;
  perform pg_temp.assert_true(v_balance = 100 and v_frozen = 0,
    '非法参数不得改动账目（实际 ' || v_balance || '/' || v_frozen || '）');

  -- 余额不足：常规不足与「金额合法但超出余额」都零副作用
  update public.credit_accounts set balance = 0, frozen = 0 where user_id = v_u;
  v_r := public.submit_generation_task(v_u, v_task, v_key, 'hd', 5, false);
  perform pg_temp.assert_true(v_r = 'insufficient', '余额不足应返回 insufficient（实际：' || v_r || '）');
  v_r := public.submit_generation_task(v_u, v_task, v_key, 'standard', 500000, false);
  perform pg_temp.assert_true(v_r = 'insufficient', '合法大额但余额不足应返回 insufficient（实际：' || v_r || '）');
  select count(*) into v_cnt from public.generation_tasks where user_id = v_u;
  perform pg_temp.assert_true(v_cnt = 0, '余额不足不得创建任务');
  select count(*) into v_cnt from public.credit_holds where user_id = v_u;
  perform pg_temp.assert_true(v_cnt = 0, '余额不足不得冻结');
  select count(*) into v_cnt from public.credit_ledger where user_id = v_u;
  perform pg_temp.assert_true(v_cnt = 0, '余额不足不得记流水');
  select balance, frozen into v_balance, v_frozen
    from public.credit_accounts where user_id = v_u;
  perform pg_temp.assert_true(v_balance = 0 and v_frozen = 0,
    '余额不足后账目应为 0/0（实际 ' || v_balance || '/' || v_frozen || '）');

  -- 非法任务状态：succeed/fail 只对 processing 生效
  update public.credit_accounts set balance = 2, frozen = 0 where user_id = v_u;
  v_r := public.submit_generation_task(v_u, v_task, v_key, 'standard', 2, false);
  perform pg_temp.assert_true(v_r = 'created:' || v_task, '提交失败（实际：' || v_r || '）');

  v_ok := public.succeed_generation_task(v_u, v_task, '<svg>queued</svg>');
  perform pg_temp.assert_true(not v_ok, 'queued 状态 succeed 应返回 false');
  v_ok := public.fail_generation_task(v_u, v_task, 'X', 'queued');
  perform pg_temp.assert_true(not v_ok, 'queued 状态 fail 应返回 false');
  v_r := public.cancel_generation_task(v_u, null);
  perform pg_temp.assert_true(v_r = 'notFound', 'NULL 任务取消应返回 notFound（实际：' || v_r || '）');
  select state into v_state from public.generation_tasks where id = v_task;
  perform pg_temp.assert_true(v_state = 'queued', '非法状态调用不得改变任务状态（实际：' || v_state || '）');
  select count(*) into v_cnt from public.credit_ledger where user_id = v_u;
  perform pg_temp.assert_true(v_cnt = 1, '非法状态调用只应有 1 条 freeze 流水（无 settle/release）');

  -- processing 下的参数校验：空结果/空失败码拒绝，正常失败释放
  update public.generation_tasks set state = 'processing', updated_at = now()
   where id = v_task and state = 'queued';
  v_ok := public.succeed_generation_task(v_u, v_task, null);
  perform pg_temp.assert_true(not v_ok, 'NULL 结果 succeed 应返回 false');
  v_ok := public.fail_generation_task(v_u, v_task, null, 'x');
  perform pg_temp.assert_true(not v_ok, 'NULL 失败码 fail 应返回 false');
  v_ok := public.fail_generation_task(v_u, v_task, 'PROVIDER_ERROR', '提供方异常');
  perform pg_temp.assert_true(v_ok, '正常 fail 应返回 true');
  select count(*) into v_cnt from public.credit_ledger
   where user_id = v_u and ref = v_task and op = 'settle';
  perform pg_temp.assert_true(v_cnt = 0, '全程不得出现 settle 流水');
  select count(*) into v_cnt from public.credit_ledger
   where user_id = v_u and ref = v_task and op = 'release';
  perform pg_temp.assert_true(v_cnt = 1, '失败应恰有一条 release 流水');
  select balance, frozen into v_balance, v_frozen
    from public.credit_accounts where user_id = v_u;
  perform pg_temp.assert_true(v_balance = 2 and v_frozen = 0,
    '失败释放后余额应回到 2/0（实际 ' || v_balance || '/' || v_frozen || '）');

  raise notice 'PASS：参数校验与非法状态（NULL/超大金额/非法质量/非法状态零副作用）';
end $$;

-- ============================================================================
-- 10) 事务中断（数据库断连模拟，u6）：客户端断连 = 事务回滚。用 PL/pgSQL
--     子事务（savepoint + EXCEPTION）等价模拟「写入已发生但连接中断」：
--     回滚后必须零残留，且同一提交/结算可安全重试（幂等恢复）。
-- ============================================================================
do $$
declare
  v_u uuid; v_cnt integer;
  v_x text := 'itest-task-disconnect-' || gen_random_uuid()::text;
  v_kx text := 'itest-key-disconnect-' || gen_random_uuid()::text;
  v_r text; v_ok boolean; v_raised boolean;
  v_balance numeric; v_frozen numeric; v_state text;
begin
  select id into v_u from test_users where name = 'u6';

  -- 10a：提交已写入但连接中断 → 回滚零残留
  v_raised := false;
  begin
    perform public.submit_generation_task(v_u, v_x, v_kx, 'standard', 2, false);
    raise exception '模拟：提交已写入但连接中断，事务回滚';
  exception when others then
    v_raised := true;
  end;
  perform pg_temp.assert_true(v_raised, '断连模拟未触发回滚');
  select count(*) into v_cnt from public.generation_tasks where id = v_x;
  perform pg_temp.assert_true(v_cnt = 0, '断连回滚后不得残留任务行');
  select count(*) into v_cnt from public.credit_holds where user_id = v_u;
  perform pg_temp.assert_true(v_cnt = 0, '断连回滚后不得残留冻结');
  select count(*) into v_cnt from public.credit_ledger
   where user_id = v_u and ref = v_x;
  perform pg_temp.assert_true(v_cnt = 0, '断连回滚后不得残留流水');
  select balance, frozen into v_balance, v_frozen
    from public.credit_accounts where user_id = v_u;
  perform pg_temp.assert_true(v_balance = 98 and v_frozen = 0,
    '断连回滚后账目不变（实际 ' || v_balance || '/' || v_frozen || '）');

  -- 重试同一提交（同键同 id）→ 正常创建
  v_r := public.submit_generation_task(v_u, v_x, v_kx, 'standard', 2, false);
  perform pg_temp.assert_true(v_r = 'created:' || v_x, '断连后重试提交应 created（实际：' || v_r || '）');
  select balance, frozen into v_balance, v_frozen
    from public.credit_accounts where user_id = v_u;
  perform pg_temp.assert_true(v_balance = 96 and v_frozen = 2,
    '重试提交后余额应为 96/2（实际 ' || v_balance || '/' || v_frozen || '）');

  -- 10b：结算已写入但连接中断 → 回滚后任务仍 processing、冻结完好，可重试
  update public.generation_tasks set state = 'processing', updated_at = now()
   where id = v_x and state = 'queued';
  v_raised := false;
  begin
    perform public.succeed_generation_task(v_u, v_x, '<svg>x</svg>');
    raise exception '模拟：结算已写入但连接中断，事务回滚';
  exception when others then
    v_raised := true;
  end;
  perform pg_temp.assert_true(v_raised, '断连模拟未触发回滚');
  select state into v_state from public.generation_tasks where id = v_x;
  perform pg_temp.assert_true(v_state = 'processing',
    '断连回滚后任务应保持 processing（实际：' || v_state || '）');
  select count(*) into v_cnt from public.credit_holds where task_id = v_x;
  perform pg_temp.assert_true(v_cnt = 1, '断连回滚后冻结明细必须完好');
  select count(*) into v_cnt from public.credit_ledger
   where user_id = v_u and ref = v_x and op = 'settle';
  perform pg_temp.assert_true(v_cnt = 0, '断连回滚后不得残留 settle 流水');
  select balance, frozen into v_balance, v_frozen
    from public.credit_accounts where user_id = v_u;
  perform pg_temp.assert_true(v_balance = 96 and v_frozen = 2,
    '断连回滚后账目不变（实际 ' || v_balance || '/' || v_frozen || '）');

  -- 重试结算 → 成功且只结算一次
  v_ok := public.succeed_generation_task(v_u, v_x, '<svg>x</svg>');
  perform pg_temp.assert_true(v_ok, '断连后重试 succeed 应返回 true');
  select count(*) into v_cnt from public.credit_ledger
   where user_id = v_u and ref = v_x and op = 'settle';
  perform pg_temp.assert_true(v_cnt = 1, '重试结算只应记一条 settle 流水');
  select balance, frozen into v_balance, v_frozen
    from public.credit_accounts where user_id = v_u;
  perform pg_temp.assert_true(v_balance = 96 and v_frozen = 0,
    '重试结算后余额应为 96/0（实际 ' || v_balance || '/' || v_frozen || '）');

  raise notice 'PASS：事务中断（断连=回滚零残留，重试幂等恢复）';
end $$;

-- ============================================================================
-- 11) 注册回填完整性（u9/u10/u11）：已有用户缺 profile 时，回填必须保证
--     「资料 + 余额账户」零遗漏——撞名只影响显示名（哈希后缀），绝不静默跳过。
--     本节的回填语句与 schema 第 13 节保持一致（有意重复：schema 更新时
--     两处需同步修改）。
--     隔离说明：不再禁用注册触发器（禁用虽只在本事务内生效，仍属高危操作）；
--     改为正常注册后删除触发器为 u9/u10 建号的行，等价模拟「历史用户缺资料」，
--     对并发注册零影响。回填会补写「缺 profile 的用户」——DO 块内先做防护
--     断言，检测到将向非测试用户写入时直接报错终止。
-- ============================================================================
with new_users as (
  insert into auth.users
    (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
     created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values
    ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'itest-backfill@example.invalid', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
    ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'itest-backfill@other.invalid', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}')
  returning id, email
)
insert into test_users (name, id)
select case email
         when 'itest-backfill@example.invalid' then 'u9'
         else 'u10' end, id
from new_users;

-- 删除触发器为 u9/u10 建号的行（级联删除其余额账户），等价模拟「历史用户
-- 缺资料」；u11 走正常触发器路径保留完整资料（见下）。
delete from public.profiles
 where id in (select id from test_users where name in ('u9','u10'));

-- u11：同前缀邮箱，但经正常触发器路径注册（已抢先占用首选名）
with new_users as (
  insert into auth.users
    (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
     created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values
    ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'itest-backfill@third.invalid', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}')
  returning id
)
insert into test_users (name, id)
select 'u11', id from new_users;

do $$
declare
  v_n integer; v_cnt integer;
  v_u9 uuid; v_u10 uuid; v_u11 uuid;
begin
  select id into v_u9  from test_users where name = 'u9';
  select id into v_u10 from test_users where name = 'u10';
  select id into v_u11 from test_users where name = 'u11';

  -- 回填前：u11 经触发器已有 profile；u9/u10 的 profile 已删除 → 无 profile
  select count(*) into v_cnt from public.profiles where id = v_u11;
  perform pg_temp.assert_true(v_cnt = 1, 'u11（触发器路径）应有 profile 行');
  select count(*) into v_cnt from public.profiles where id in (v_u9, v_u10);
  perform pg_temp.assert_true(v_cnt = 0, '回填前 u9/u10 不应有 profile 行（已删除模拟缺资料）');

  -- 隔离防护：下面要运行与 schema 第 13 节一致的全量回填，会向「缺少 profile 的
  -- auth 用户」补写数据。若存在不属于本文件测试用户的此类用户，拒绝执行，
  -- 避免在共享项目上改动他人数据（请改用隔离测试环境运行本文件）。
  if exists (
    select 1 from auth.users u
     where not exists (select 1 from test_users t where t.id = u.id)
       and not exists (select 1 from public.profiles p where p.id = u.id)
  ) then
    raise exception '检测到缺少 profile 的非测试用户：注册回填测试会为其写入数据，请改用隔离测试环境运行本文件';
  end if;

  -- ① 首选名回填（与 schema 第 13 节一致）
  insert into public.profiles (id, username)
  select u.id,
         u.base || case when u.rn = 1 then '' else '-' || left(md5(u.id::text), 8) end
  from (
    select id, email,
           coalesce(nullif(split_part(email, '@', 1), ''), 'user') as base,
           row_number() over (
             partition by coalesce(nullif(split_part(email, '@', 1), ''), 'user')
             order by id
           ) as rn
    from auth.users
  ) u
  on conflict do nothing;

  -- ② 修复循环（与 schema 第 13 节一致）：仍缺 profile 的用户用哈希后缀补建
  loop
    insert into public.profiles (id, username)
    select u.id,
           coalesce(nullif(split_part(u.email, '@', 1), ''), 'user')
             || '-' || left(md5(u.id::text), 8)
      from auth.users u
     where not exists (select 1 from public.profiles p where p.id = u.id)
    on conflict (username) do nothing;
    get diagnostics v_n = row_count;
    exit when v_n = 0;
  end loop;

  -- 余额账户（与 schema 第 13 节一致）
  insert into public.credit_accounts (user_id)
    select id from public.profiles
    on conflict (user_id) do nothing;

  -- ③ 完整性断言（schema 第 13 节断言全体 auth 用户；本测试只断言测试用户，
  --    避免共享项目上既有数据缺口干扰——对非测试用户的写入已被上方防护拦截）
  if exists (
    select 1 from test_users t
     where not exists (select 1 from public.profiles p where p.id = t.id)
  ) then
    raise exception '回填完整性检查失败：存在缺少 profile 行的测试用户';
  end if;
  if exists (
    select 1 from test_users t
     where not exists (select 1 from public.credit_accounts a where a.user_id = t.id)
  ) then
    raise exception '回填完整性检查失败：存在缺少余额账户的测试用户';
  end if;

  -- 回填后：三人都有 profile + 100 余额账户；撞名用户拿到哈希后缀而非被跳过
  select count(*) into v_cnt from public.profiles
   where id in (v_u9, v_u10, v_u11);
  perform pg_temp.assert_true(v_cnt = 3, '回填后三人必须都有 profile 行（零遗漏）');
  select count(*) into v_cnt from public.credit_accounts
   where user_id in (v_u9, v_u10, v_u11) and balance = 100 and frozen = 0;
  perform pg_temp.assert_true(v_cnt = 3, '回填后三人必须都有 100 余额账户（零遗漏）');
  select count(*) into v_cnt from public.profiles
   where id in (v_u9, v_u10, v_u11) and username = 'itest-backfill';
  perform pg_temp.assert_true(v_cnt = 1, '恰一人保留首选名 itest-backfill（实际：' || v_cnt || '）');
  select count(*) into v_cnt from public.profiles
   where id in (v_u9, v_u10, v_u11) and username like 'itest-backfill-%';
  perform pg_temp.assert_true(v_cnt = 2, '撞名的两人必须拿到哈希后缀用户名而非被跳过（实际：' || v_cnt || '）');

  -- 触发器全程保持启用（本测试不禁用触发器，不影响并发注册）
  select count(*) into v_cnt from pg_trigger
   where tgrelid = 'auth.users'::regclass
     and tgname = 'on_auth_user_created' and tgenabled = 'O';
  perform pg_temp.assert_true(v_cnt = 1, '注册触发器必须全程保持启用');

  raise notice 'PASS：注册回填完整性（撞名走哈希后缀，资料+账户零遗漏）';
end $$;

-- ============================================================================
-- 12) 清理：删除测试用户即级联清空全部业务数据（profiles → credit_accounts /
--     credit_holds / credit_ledger / generation_tasks 全部 on delete cascade）
-- ============================================================================
do $$
declare v_cnt integer;
begin
  delete from auth.users u using test_users t where u.id = t.id;

  select count(*) into v_cnt from public.profiles p
   join test_users t on t.id = p.id;
  perform pg_temp.assert_true(v_cnt = 0, '清理后不应残留测试 profiles 行');

  raise notice '✓ 全部集成测试通过，测试数据已清理（auth.users 级联删除）';
end $$;

-- 事务结束：整份测试一个事务（见文件头「事务边界」）。若执行工具已包了
-- 外层事务，本 commit 会提交外层事务（其后无任何语句，无害）。
commit;

-- ============================================================================
-- 附录 A（可选，双会话真实竞态）【待验证：以下步骤尚未在任何环境实际执行，
--   需在迁移完成后的隔离环境人工运行并核对不变量。本文件交付时未声称已通过
--   真实并发验证——单会话确定性交错已由第 6 节覆盖并断言】：succeed 与 cancel
--   同时到达同一 processing 任务，验证「settle 与 release 只可能发生其一」在
--   真实并行下成立。
--   需要两个数据库连接（SQL Editor 每个标签页是独立连接，但语句间事务边界
--   不可控，推荐 psql）。准备（主窗口，一次提交并进入 processing）：
--
--     psql "<连接串>" -v ON_ERROR_STOP=1 <<'SQL'
--     begin;
--     select public.submit_generation_task('<U>','<TASK>','<KEY>','standard',2,false);
--     update public.generation_tasks set state='processing', updated_at=now()
--      where id='<TASK>';
--     commit;
--     SQL
--
--   窗口 A 与窗口 B 同时执行（pg_sleep 对齐起跑，行锁仲裁谁先谁后）：
--     窗口 A：psql "<连接串>" -c "select pg_sleep(1); select public.succeed_generation_task('<U>','<TASK>','<svg>race</svg>');"
--     窗口 B：psql "<连接串>" -c "select pg_sleep(1); select public.cancel_generation_task('<U>','<TASK>');"
--
--   A、B 都结束后在主窗口验证不变量（三个结果都应为 true）：
--     select (select count(*) from public.credit_ledger where ref='<TASK>') = 1,
--            (select count(*) from public.credit_holds where task_id='<TASK>') = 0,
--            (select frozen from public.credit_accounts where user_id='<U>') = 0;
--
--   <U> 需为真实存在的用户（面板建号即可）。单会话确定性交错已由第 6 节覆盖，
--   本附录验证真实并发下的行锁仲裁。
-- ============================================================================

-- ============================================================================
-- 附录 B（可选，双会话真实竞态）【待验证：同上，尚未在任何环境实际执行】：
--   restore_orphan_holds 与 settle_credits 同时处理同一笔孤儿冻结，验证
--   「restore 与 settle 只可能发生其一、余额只更新一次」——对应
--   restore_orphan_holds 逐行 for update skip locked 的并发安全修复
--   （审查问题 1）。
--   准备（主窗口）：构造一笔孤儿冻结（无任务引用），并同步账户冻结池：
--
--     psql "<连接串>" -v ON_ERROR_STOP=1 <<'SQL'
--     begin;
--     insert into public.credit_holds (user_id, task_id, amount) values ('<U>', '<GHOST>', 5);
--     update public.credit_accounts set frozen = frozen + 5 where user_id = '<U>';
--     commit;
--     SQL
--
--   窗口 A 与窗口 B 同时执行（pg_sleep 对齐起跑）：
--     窗口 A：psql "<连接串>" -c "select pg_sleep(1); select public.restore_orphan_holds();"
--     窗口 B：psql "<连接串>" -c "select pg_sleep(1); select public.settle_credits('<U>', '<GHOST>');"
--   （B 返回 true 说明 settle 赢；返回 false 说明 restore 先删除了冻结行。）
--
--   A、B 都结束后在主窗口验证不变量（三个结果都应为 true）：
--     select (select count(*) from public.credit_ledger where ref='<GHOST>') = 1,
--            (select count(*) from public.credit_holds where task_id='<GHOST>') = 0,
--            (select frozen from public.credit_accounts where user_id='<U>') = 0;
--
--   第一条保证「restore 与 settle 只发生其一」；第三条保证冻结池只退了一次。
--   <U> 需为真实存在的用户。单会话确定性先后顺序已由第 8 节（8a/8b）覆盖。
-- ============================================================================
