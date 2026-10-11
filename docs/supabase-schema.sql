-- ============================================================================
-- AI Clothes · Supabase PostgreSQL 建表与安全策略（docs/supabase-schema.sql）
-- 版本：v2.2（迁移前终审版）
-- 修订（v2.1 → v2.2）：
--   · 第 5 节：generation_tasks 增加三条状态机一致性 CHECK 约束（活动任务
--     finished_at 必须为空、终态必有 finished_at、result_svg 仅 succeeded 可存、
--     failure_code/message 仅 failed 可存）——租约/心跳语义的数据库级兜底，
--     配合第 14 节自检断言与集成测试的租约边界用例。
--   · 第 9 节：ALTER DEFAULT PRIVILEGES 只声明 postgres（本项目唯一会创建对象
--     的角色，SQL Editor 与迁移均以其执行），且全部改用「不带 IN SCHEMA 的
--     全局声明」——按 schema 的 REVOKE 只能撤销按 schema 的 GRANT，**撤销不了
--     全局已授予的默认权限**（含内建默认：新函数默认授 PUBLIC EXECUTE，属于
--     全局级授权）；平台（Supabase）为 postgres 配置的 anon/authenticated 默认
--     授权同样在全局级，因此必须在全局级撤销。对 supabase_admin / service_role /
--     authenticator 等平台角色的默认权限一律不触碰；service_role 的默认授权
--     （ALL）保留（服务器直读账本表所需）。最终生效授权由第 14 节自检「实建
--     探针对象」直接验证（pg_default_acl 只描述规则，探针才是最终效果）。
--   · 第 10 节函数加固：
--       - restore_orphan_holds 改为逐行 for update skip locked 锁定冻结记录、
--         锁定后重新验证任务状态——与 settle/release 并发时只可能一方生效，
--         杜绝重复更新余额（与后两者对同一冻结行的加锁互斥，锁序一致）；
--       - settle_credits 改为返回 boolean；succeed_generation_task 在结算未
--         实际发生（缺少冻结记录）时 RAISE 回滚——任务绝不带着未扣费的状态
--         落地 succeeded；
--       - 全部写路径函数显式校验 NULL 参数、超大金额（> 9999999999.99，与
--         numeric(12,2) 容量对齐）与非法任务状态——PostgreSQL 的 CHECK 对
--         NULL 恒真，不能只靠约束兜底；非法输入一律零副作用。
--   · 第 11 节：修复触发器授权缺陷——revoke from public 之后，handle_new_auth_user
--     必须显式授给实际触发它的平台角色 supabase_auth_admin（GoTrue 以该角色
--     写入 auth.users），否则注册会因权限不足失败；不再授予 service_role。
--   · 第 13 节：回填升级为「首选名 + 哈希后缀修复循环 + 完整性断言」——任何
--     auth 用户都必须有 profile、任何 profile 都必须有余额账户，缺一即 RAISE
--     （整次迁移回滚），不再靠 on conflict do nothing 静默遗漏（撞名只影响
--     显示名，不影响资料与账户的建立）。
--   · 第 14 节：执行后自检从 8 条人工核对升级为「自动化结构自检」DO 块——
--     表/列/类型/约束/索引（含状态机一致性约束）/RLS/策略/函数属性/授权/
--     触发器/默认权限（规则断言 + 实建探针验证最终生效授权）逐项断言，任何
--     一项不符即 RAISE EXCEPTION。迁移成功与否由自检判定，不再只靠
--     if not exists。自检失败使整次执行回滚，不存在「部分迁移」被当作成功。
--   · 第 15 节：保留无法自动化的人工冒烟项（真实注册、整脚本重跑）。
-- 执行方式：Supabase 项目 → SQL Editor → 以 postgres 身份粘贴全文 → Run。
-- 配套：docs/supabase-integration-tests.sql（真实 PostgreSQL 集成测试：冻结/
--   结算/释放/重复提交/成功与取消竞争/并发结算与孤儿恢复/租约心跳边界/
--   数据库断连/注册回填/参数校验）；docs/migration-checklist.md（迁移前检查
--   清单）。执行顺序与人工步骤见后者，经确认后再执行。
--
-- ▍幂等与数据安全：本脚本可安全重复执行。
--    · 全部建表/建索引带 if not exists；policy 先 drop if exists 再 create；
--      函数 create or replace；revoke/grant/RLS/自检语句天然幂等。
--    · 唯一会写数据的语句：① 第 13 节幂等回填（仅补缺行，on conflict do nothing）；
--      ② 第 12 节建 username 唯一约束前的消歧 UPDATE（仅当约束缺失且存在重名时
--      执行一次，只给重名行追加后缀，不删除任何数据）。
--    · 全文无 DROP TABLE、无 DELETE/TRUNCATE 业务数据（第 14 节自检的临时
--      探针对象除外：实建即删、不承载任何数据）。
--    · 第 14 节自检失败会 RAISE 使整次执行回滚：迁移要么整体成功、要么整体
--      回滚，不存在「部分迁移」被当作成功。
--
-- ▍并发语义速查（与服务器代码共同保证，详见下方函数内注释）：
--    同键并发提交  → 唯一索引仲裁，后到者返回 reused，不重复冻结
--    同键重试      → 先查幂等键已存在即返回 reused；插入冲突路径冻结未发生
--    成功 vs 取消  → 行锁串行化：settle 与 release 只可能发生其一
--    孤儿恢复 vs 结算/释放 → 冻结行锁互斥（for update skip locked + 锁定后
--                            复验任务状态）：同一冻结只可能被处理一次
--    重复结算      → hold 行锁 + credit_ledger 部分唯一索引双保险
--    超时恢复      → 仅回收 updated_at 超阈值的活动任务；执行中的任务不断刷新
--                    updated_at，且候选查询 for update skip locked 防误伤
--
-- ▍演示边界：注册赠送的 100 Credits 仅用于开发测试，不代表真实付费额度；
--    不接入支付。金额一律 numeric，禁止浮点。
--
-- ▍应用模式（服务器代码侧）：APP_MODE=demo（默认，内存账本，不连接数据库）
--    与 APP_MODE=production（必须配置本数据库；配置缺失直接失败，禁止回退
--    内存账本）。本 SQL 只服务 production 模式，demo 模式不连接数据库。
--
-- ▍安全模型（三层防护，客户端对账本零写权限）：
--    ① RLS：五表全部启用，仅「读自己行」的最小 select 策略，零写策略；
--    ② 表级权限：显式收回 anon/authenticated 的 insert/update/delete/truncate/
--       references/trigger（Supabase 默认授权含 ALL，TRUNCATE 不受 RLS 约束），
--       anon 连 select 也收回；authenticated 仅保留并显式授予 select；
--    ③ 函数权限：10 个业务函数仅授 service_role；触发器函数仅授实际触发它的
--       supabase_auth_admin；对 public/anon/authenticated 一律 revoke。
--    Next.js 服务器经 service_role 调用函数（rpc），每次调用 = 一个事务，
--    等价 demo 版 locked() 临界区。
-- ============================================================================

-- 1) 用户资料：一行对应一个 Supabase Auth 用户（auth.users）。
--    username 唯一（触发器与回填都做了撞名消歧，见第 6/12/13 节）。
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  created_at timestamptz not null default now()
);

-- 2) Credits 余额账户：一行一用户；演示初始 100（仅开发测试，非真实付费额度）。
create table if not exists public.credit_accounts (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  balance numeric(12,2) not null default 100 check (balance >= 0),
  frozen  numeric(12,2) not null default 0   check (frozen >= 0),
  updated_at timestamptz not null default now()
);

-- 3) 冻结明细：等价 demo 版 freezes Map（task_id 即 ref）；一任务只可能有一笔冻结。
create table if not exists public.credit_holds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  task_id text not null,
  amount numeric(12,2) not null check (amount > 0),
  created_at timestamptz not null default now()
);
create unique index if not exists credit_holds_task_once_idx
  on public.credit_holds (task_id);

-- 4) 流水：等价 demo 版 journal；settle 部分唯一索引防重复结算。
create table if not exists public.credit_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  op text not null check (op in ('freeze','settle','release','restore')),
  amount numeric(12,2) not null,
  ref text,
  created_at timestamptz not null default now()
);
create index if not exists credit_ledger_user_idx
  on public.credit_ledger (user_id, created_at desc);
create unique index if not exists credit_ledger_settle_once_idx
  on public.credit_ledger (user_id, ref) where op = 'settle';

-- 5) 生成任务：等价 demo 版 Task；result_svg 为演示结果（真实服务换成 Storage 对象引用）。
create table if not exists public.generation_tasks (
  id text primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  idempotency_key text not null,
  quality text not null check (quality in ('standard','hd')),
  cost numeric(12,2) not null check (cost > 0),
  simulate_failure boolean not null default false,
  state text not null check (state in ('queued','processing','succeeded','failed','cancelled')),
  saved boolean not null default false,
  failure_code text,
  failure_message text,
  result_svg text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (user_id, idempotency_key)
);
-- 每人同时只有一个活动任务（等价 demo 版 active Map）。
create unique index if not exists generation_tasks_one_active_idx
  on public.generation_tasks (user_id) where state in ('queued','processing');
create index if not exists generation_tasks_updated_idx
  on public.generation_tasks (updated_at);

-- 状态机一致性约束（租约/心跳语义的数据库级兜底，幂等创建）：
--   ① 活动任务（queued/processing）不得有 finished_at，终态必须有 finished_at
--      —— 任何路径都写不出「半终结」行；
--   ② result_svg 只能出现在 succeeded（结果与状态联动）；
--   ③ failure_code/failure_message 只能出现在 failed（失败信息与状态联动）。
--   服务器每 10s 刷新 updated_at（心跳），对账只按「租约过期」回收执行中任务，
--   这些约束保证长任务在心跳持续时不会被任何写入路径错置状态。
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'generation_tasks_state_finished_ck' and contype = 'c'
       and conrelid = 'public.generation_tasks'::regclass
  ) then
    alter table public.generation_tasks
      add constraint generation_tasks_state_finished_ck check (
        (state in ('queued','processing') and finished_at is null)
        or (state in ('succeeded','failed','cancelled') and finished_at is not null));
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'generation_tasks_result_state_ck' and contype = 'c'
       and conrelid = 'public.generation_tasks'::regclass
  ) then
    alter table public.generation_tasks
      add constraint generation_tasks_result_state_ck check (
        state = 'succeeded' or result_svg is null);
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'generation_tasks_failure_state_ck' and contype = 'c'
       and conrelid = 'public.generation_tasks'::regclass
  ) then
    alter table public.generation_tasks
      add constraint generation_tasks_failure_state_ck check (
        state = 'failed' or (failure_code is null and failure_message is null));
  end if;
end $$;

-- 6) 注册触发器：Supabase Auth 注册新用户时，自动建 profiles 行并开演示余额账户。
--    username 撞名消歧：先尝试邮箱前缀；撞唯一约束（并发注册或历史同名）时改用
--    「前缀-短哈希」确定性后缀（基于 id，必唯一）。内层 EXCEPTION 是子事务：
--    失败的插入语句已回滚，重试插入与新行在同一事务，profile 与余额账户
--    要么一起成功、要么一起回滚（注册失败），不存在半截状态。
--    执行权限见第 11 节：revoke from public 后必须授给实际触发它的
--    supabase_auth_admin（GoTrue 以该角色写入 auth.users），否则注册触发失败。
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_name text := coalesce(nullif(split_part(new.email, '@', 1), ''), 'user');
begin
  begin
    insert into public.profiles (id, username) values (new.id, v_name);
  exception
    when unique_violation then
      v_name := v_name || '-' || left(md5(new.id::text), 8);
      insert into public.profiles (id, username) values (new.id, v_name);
  end;
  insert into public.credit_accounts (user_id) values (new.id);
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- ============================================================================
-- 7) 行级安全（RLS）—— 最小权限：只允许 authenticated 读自己的行，零写策略。
--    （PostgreSQL 的 create policy 没有 if not exists，故先 drop 再 create，
--    保证重复执行安全。）
-- ============================================================================
alter table public.profiles         enable row level security;
alter table public.credit_accounts  enable row level security;
alter table public.credit_holds     enable row level security;
alter table public.credit_ledger    enable row level security;
alter table public.generation_tasks enable row level security;

drop policy if exists profiles_select_own         on public.profiles;
drop policy if exists credit_accounts_select_own  on public.credit_accounts;
drop policy if exists credit_holds_select_own     on public.credit_holds;
drop policy if exists credit_ledger_select_own    on public.credit_ledger;
drop policy if exists generation_tasks_select_own on public.generation_tasks;

create policy profiles_select_own
  on public.profiles for select using (auth.uid() = id);
create policy credit_accounts_select_own
  on public.credit_accounts for select using (auth.uid() = user_id);
create policy credit_holds_select_own
  on public.credit_holds for select using (auth.uid() = user_id);
create policy credit_ledger_select_own
  on public.credit_ledger for select using (auth.uid() = user_id);
create policy generation_tasks_select_own
  on public.generation_tasks for select using (auth.uid() = user_id);

-- ============================================================================
-- 8) 表级权限收紧：Supabase 平台默认给 anon/authenticated 授了 public 下所有表
--    的 ALL 权限，其中 TRUNCATE 不受 RLS 约束，必须显式收回；客户端只保留
--    「读自己行」所需的 SELECT，且仅限 authenticated（anon 无策略可匹配）。
--    grant select 为显式声明，不依赖平台默认授权。
-- ============================================================================
revoke insert, update, delete, truncate, references, trigger
  on public.profiles, public.credit_accounts, public.credit_holds,
     public.credit_ledger, public.generation_tasks
  from anon, authenticated;
revoke select
  on public.profiles, public.credit_accounts, public.credit_holds,
     public.credit_ledger, public.generation_tasks
  from anon;
grant select
  on public.profiles, public.credit_accounts, public.credit_holds,
     public.credit_ledger, public.generation_tasks
  to authenticated;

-- 身份列序列同步收紧：credit_ledger 的 identity 列会自动建序列（relkind='S'），
-- 平台默认授权可能已授给客户端角色；序列不随表授权收回，需单独处理。
do $$
declare v_rec record;
begin
  for v_rec in
    select c.oid as seq_oid from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     join pg_depend d on d.objid = c.oid and d.deptype in ('i','a')
     join pg_class t on t.oid = d.refobjid
     join pg_namespace tn on tn.oid = t.relnamespace
    where n.nspname = 'public' and c.relkind = 'S'
      and tn.nspname = 'public'
      and t.relname in ('profiles','credit_accounts','credit_holds',
                        'credit_ledger','generation_tasks')
  loop
    execute format('revoke all on sequence %s from anon, authenticated',
                   v_rec.seq_oid::regclass);
  end loop;
end $$;

-- 9) 未来新建对象的默认权限（最小范围：只声明本项目实际创建对象的角色）。
--    ALTER DEFAULT PRIVILEGES 按 (创建角色, schema, 对象类型) 生效，只影响
--    「该角色之后新建」的对象；存量对象由第 8 节的显式 revoke 治理。
--    本项目的新对象只会由 postgres 创建（SQL Editor 与迁移脚本均以 postgres
--    执行），因此只声明 postgres。平台角色（supabase_admin、service_role、
--    authenticator 等）的默认权限属于平台自身对象的授权机制，本脚本不触碰，
--    避免无意改变我们不拥有的对象（平台扩展、内部表）的默认授权。
--    两级默认权限的正确关系（PostgreSQL 官方语义）：默认权限分「全局」
--    （不带 IN SCHEMA，defaclnamespace = 0）与「按 schema」（带 IN SCHEMA）
--    两级，且 schema 级条目是**叠加**在全局级之上——按 schema 的 REVOKE 只能
--    撤销按 schema 的 GRANT，**无法撤销全局已授予的默认权限**；内建默认
--    （新函数默认授 PUBLIC EXECUTE）同样属于全局级授权；平台（Supabase）为
--    postgres 配置的 anon/authenticated 默认授权也在全局级。因此本节全部使用
--    **不带 IN SCHEMA 的全局声明**撤销，并由第 14 节自检「实建探针对象」
--    验证最终生效的授权（pg_default_acl 只描述规则，探针才是最终效果）。
--    service_role 的默认授权（ALL）保留不动——服务器需经 service_role 直读
--    账本表（见 app/server/db/*），这是需要的；自检探针同时断言该保留。
-- ============================================================================
alter default privileges for role postgres
  revoke all on tables    from anon, authenticated;
alter default privileges for role postgres
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres
  revoke all on functions from anon, authenticated;
alter default privileges for role postgres
  revoke all on functions from public;  -- 撤销内建默认的 PUBLIC EXECUTE（全局级）
alter default privileges for role postgres
  revoke all on sequences from public;  -- 防御性：撤销序列的 PUBLIC USAGE/SELECT

-- 两级叠加：上面的全局声明撤销了全局级授权（含内建默认与平台全局默认）；
-- 以下 schema 级声明再撤销 public 内可能已存在的 schema 级默认授权——两级
-- 默认权限是叠加生效的，撤销必须两层都做。最终生效结果由第 14 节自检实建
-- 探针验证（探针检查的是两级叠加后的真实授权）。
alter default privileges for role postgres in schema public
  revoke all on functions from public;
alter default privileges for role postgres in schema public
  revoke all on sequences from public;
alter default privileges for role postgres in schema public
  revoke all on tables    from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on functions from anon, authenticated;

-- 防御性：客户端角色不应在 public schema 建对象。
revoke create on schema public from anon, authenticated;

-- ============================================================================
-- 10) 事务函数 —— 只经服务器（service_role）调用，客户端已全部 revoke。
--     PostgREST 无法跨语句开事务，每个原子操作封装为一个函数：一次 rpc = 一个
--     数据库事务。全部函数 SECURITY DEFINER、属主 postgres、声明
--     set search_path = pg_catalog, public，且所有表/函数引用带 public. 前缀，
--     杜绝 search_path 劫持。参数校验：写路径函数入口处显式校验（负金额、
--     空键等），表级 CHECK 约束为第二道防线。
-- ============================================================================

-- 冻结：可用余额足够才扣减并加冻结池；不足/非法金额返回 false，整体无副作用。
-- 重复 task_id 防御性检查：正常调用方只用全新任务 id，不可达；兜底避免唯一索引
-- 硬报错（并发双冻结时第二个事务整体回滚，不会重复扣减）。
-- 金额上限与 cost 列 numeric(12,2) 容量对齐：超过上限的数值无法入列，必须在
-- 入口拒绝（否则依赖列约束报错，且 CHECK 对 NULL 恒真，NULL 也须显式拦截）。
create or replace function public.freeze_credits(p_user uuid, p_amount numeric, p_task text)
returns boolean
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if p_amount is null or p_amount <= 0 or p_amount > 9999999999.99
     or p_task is null or p_task = '' then
    return false;                                    -- 参数校验：NULL/非法金额/空引用直接拒绝
  end if;
  if exists (select 1 from public.credit_holds where task_id = p_task) then
    return false;
  end if;
  update public.credit_accounts
     set balance = balance - p_amount, frozen = frozen + p_amount, updated_at = now()
   where user_id = p_user and balance >= p_amount;
  if not found then
    return false;
  end if;
  insert into public.credit_holds (user_id, task_id, amount) values (p_user, p_task, p_amount);
  insert into public.credit_ledger (user_id, op, amount, ref) values (p_user, 'freeze', p_amount, p_task);
  return true;
end $$;

-- 结算：结果已落库（可下载）后调用；返回是否真实发生结算。
-- 返回 false 表示没有可结算的冻结行（重复回调，或冻结记录缺失）——调用方
-- 不得据此把任务当作已结算：succeed_generation_task 在 false 时会 RAISE 回滚，
-- 任务绝不带着未扣费的状态落地 succeeded（见该函数注释）。
create or replace function public.settle_credits(p_user uuid, p_task text)
returns boolean
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_amount numeric(12,2);
begin
  select amount into v_amount from public.credit_holds
   where user_id = p_user and task_id = p_task for update;
  if not found then
    return false;
  end if;
  insert into public.credit_ledger (user_id, op, amount, ref) values (p_user, 'settle', v_amount, p_task);
  delete from public.credit_holds where user_id = p_user and task_id = p_task;
  update public.credit_accounts
     set frozen = frozen - v_amount, updated_at = now() where user_id = p_user;
  return true;
end $$;

-- 释放：失败/取消/超时退还冻结；与结算对称反向，同样幂等。
create or replace function public.release_credits(p_user uuid, p_task text)
returns void
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_amount numeric(12,2);
begin
  select amount into v_amount from public.credit_holds
   where user_id = p_user and task_id = p_task for update;
  if not found then
    return;
  end if;
  insert into public.credit_ledger (user_id, op, amount, ref) values (p_user, 'release', v_amount, p_task);
  delete from public.credit_holds where user_id = p_user and task_id = p_task;
  update public.credit_accounts
     set balance = balance + v_amount, frozen = frozen - v_amount, updated_at = now()
   where user_id = p_user;
end $$;

-- 孤儿冻结恢复（对账兜底）：只恢复「不引用任何存活活动任务」的冻结；
-- 引用 queued/processing 任务的冻结一律保留，绝不误释放执行中的任务。
-- 并发安全：候选冻结逐行 for update skip locked 加锁——与 settle/release 对
-- 同一冻结行的加锁互斥，三者只可能有一方生效，杜绝「结算后又恢复、释放后
-- 又恢复」的重复更新余额；锁定后再次验证任务状态（防与提交任务并发产生的
-- 新引用竞争）才记账。被并发事务锁住的行本轮跳过（skip locked），下轮
-- 对账再处理。锁序与 settle/release 一致（先冻结行、后账户行），无死锁环。
create or replace function public.restore_orphan_holds()
returns integer
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_rec record; v_restored integer := 0;
begin
  for v_rec in
    select h.id, h.user_id, h.task_id, h.amount
      from public.credit_holds h
     where not exists (
       select 1 from public.generation_tasks t
        where t.id = h.task_id and t.state in ('queued','processing')
     )
     for update skip locked
  loop
    -- 锁定后重新验证：此刻仍无存活活动任务引用，才恢复
    if exists (
      select 1 from public.generation_tasks t
       where t.id = v_rec.task_id and t.state in ('queued','processing')
    ) then
      continue;
    end if;
    insert into public.credit_ledger (user_id, op, amount, ref)
    values (v_rec.user_id, 'restore', v_rec.amount, v_rec.task_id);
    update public.credit_accounts
       set balance = balance + v_rec.amount, frozen = frozen - v_rec.amount, updated_at = now()
     where user_id = v_rec.user_id;
    delete from public.credit_holds where id = v_rec.id;
    v_restored := v_restored + 1;
  end loop;
  return v_restored;
end $$;

-- 提交任务：任务创建 + 冻结在同一事务内完成。并发竞争由唯一索引仲裁：
--   先插入（同幂等键 / 已有活动任务 → unique_violation → 整体回滚 → 返回
--   reused / inProgress）；再冻结，余额不足则删除刚插入的任务行并返回
--   insufficient（无冻结、无任务、无流水，与 demo 版「整体回滚」语义一致）。
--   本函数没有 EXCEPTION 捕获内部逻辑错误，仅捕获唯一索引竞争（子事务语义：
--   进入 handler 时本函数已写入的行一并回滚——此刻冻结尚未发生或随之一并
--   回滚，账本/任务/流水三者保持一致，不存在半截状态）。
create or replace function public.submit_generation_task(
  p_user uuid, p_id text, p_idempotency_key text,
  p_quality text, p_cost numeric, p_simulate_failure boolean
)
returns text
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_existing text;
begin
  if p_user is null
     or p_id is null or p_id = ''
     or p_idempotency_key is null or p_idempotency_key = ''
     or p_quality is null or p_quality not in ('standard','hd')
     or p_cost is null or p_cost <= 0 or p_cost > 9999999999.99 then
    return 'invalid';  -- 参数校验：NULL/空键/非法质量/非法消耗直接拒绝，零副作用
  end if;
  insert into public.generation_tasks
    (id, user_id, idempotency_key, quality, cost, simulate_failure, state)
  values (p_id, p_user, p_idempotency_key, p_quality, p_cost, coalesce(p_simulate_failure, false), 'queued');

  if not public.freeze_credits(p_user, p_cost, p_id) then
    delete from public.generation_tasks where id = p_id;
    return 'insufficient';
  end if;
  return 'created:' || p_id;
exception
  when unique_violation then
    -- 并发冲突：本次插入（与尚未发生的冻结）已随异常整体回滚；
    -- 返回已提交的既有任务，不会重复冻结、重复扣费。
    select id into v_existing from public.generation_tasks
     where user_id = p_user and idempotency_key = p_idempotency_key;
    if v_existing is not null then return 'reused:' || v_existing; end if;
    select id into v_existing from public.generation_tasks
     where user_id = p_user and state in ('queued','processing');
    if v_existing is not null then return 'inProgress:' || v_existing; end if;
    raise;
end $$;

-- 生成成功：先写结果并把任务置 succeeded，再结算（同一事务，顺序保证
-- “结果已保存可下载，才正式扣费”）。状态不符/重复回调返回 false，幂等。
-- 结算必须真实发生：若冻结记录缺失（不变量被破坏，如被对账孤儿恢复误动），
-- RAISE 使整个事务回滚——任务状态不落地（保持 processing），绝不带着未扣费
-- 的状态返回成功；该任务随后由对账租约回收（超时置 failed 并释放，无副作用）。
-- 锁序：先任务行、后冻结行，与 cancel/fail 一致，无死锁环。
create or replace function public.succeed_generation_task(
  p_user uuid, p_task text, p_result_svg text
)
returns boolean
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if p_user is null or p_task is null or p_task = '' or p_result_svg is null then
    return false;                                    -- 参数校验：无结果内容不结算
  end if;
  update public.generation_tasks
     set state = 'succeeded', result_svg = p_result_svg, finished_at = now(), updated_at = now()
   where id = p_task and user_id = p_user and state = 'processing';
  if not found then
    return false;
  end if;
  if not public.settle_credits(p_user, p_task) then
    raise exception '结算失败：任务 % 缺少冻结记录，本次成功回调已回滚（任务保持 processing，由对账回收）', p_task;
  end if;
  return true;
end $$;

-- 生成失败：置 failed 并释放冻结（同一事务）。仅 processing 可失败（与 demo 版
-- 一致；卡在 queued 的任务统一交给对账超时回收，语义与 demo 版相同）。
create or replace function public.fail_generation_task(
  p_user uuid, p_task text, p_code text, p_message text
)
returns boolean
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if p_user is null or p_task is null or p_task = '' or p_code is null or p_code = '' then
    return false;                                    -- 参数校验：失败原因缺失不落库
  end if;
  update public.generation_tasks
     set state = 'failed', failure_code = p_code, failure_message = p_message,
         finished_at = now(), updated_at = now()
   where id = p_task and user_id = p_user and state = 'processing';
  if not found then
    return false;
  end if;
  perform public.release_credits(p_user, p_task);
  return true;
end $$;

-- 取消任务：cancelled = 已取消；notActive = 已结束；notFound = 不存在/不属于该用户。
-- 行级 for update 锁保证与 succeed/fail/对账并发时只有一个赢家。
create or replace function public.cancel_generation_task(p_user uuid, p_task text)
returns text
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_state text;
begin
  if p_task is null or p_task = '' then
    return 'notFound';                               -- 参数校验：空引用直接拒绝
  end if;
  select state into v_state from public.generation_tasks
   where id = p_task and user_id = p_user for update;
  if v_state is null then return 'notFound'; end if;
  if v_state not in ('queued','processing') then return 'notActive'; end if;
  update public.generation_tasks
     set state = 'cancelled', finished_at = now(), updated_at = now()
   where id = p_task and user_id = p_user;
  perform public.release_credits(p_user, p_task);
  return 'cancelled';
end $$;

-- 保存作品（演示标记）：仅 succeeded 可保存。
create or replace function public.save_generation_task(p_user uuid, p_task text)
returns boolean
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  update public.generation_tasks set saved = true, updated_at = now()
   where id = p_task and user_id = p_user and state = 'succeeded';
  return found;
end $$;

-- 对账（等价 demo 版 reconcileNow）：超时回收 + 保留期清理 + 孤儿冻结恢复。
-- 防误释放正在执行任务的保障：
--   ① 候选查询 for update skip locked——被 succeed/fail/cancel 并发修改中的
--      行本轮跳过，下轮再查；
--   ② 更新时再次校验状态仍为 queued/processing，才执行 release；
--   ③ 服务器把 queued→processing 的转移刷新 updated_at（与 demo 版一致），
--      使「仍在执行」的任务不断刷新时间戳，不会被误判超时；
--   ④ 超时阈值须大于真实生成服务的最坏耗时（默认 60s，可按需传参）。
-- 生产调度（暂不启用，仅注释）：pg_cron 待数据库联调完成后再配置（需先
--   create extension if not exists pg_cron，再按下方语句调度；本脚本不创建
--   扩展、不执行任何 cron.schedule）：
--   select cron.schedule('reconcile-generation', '30 seconds',
--     $$ select public.reconcile_generation() $$);
create or replace function public.reconcile_generation(
  p_timeout_ms bigint default 60000, p_retention_ms bigint default 1800000
)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_rec record; v_timed_out integer := 0; v_pruned integer := 0;
begin
  if p_timeout_ms <= 0 or p_retention_ms <= 0 then
    raise exception '参数校验失败：超时/保留期必须为正数';
  end if;
  for v_rec in
    select id, user_id from public.generation_tasks
     where state in ('queued','processing')
       and extract(epoch from (now() - updated_at)) * 1000 > p_timeout_ms
     for update skip locked
  loop
    update public.generation_tasks
       set state = 'failed', failure_code = 'TIMEOUT',
           failure_message = '任务超时，系统已回收冻结额度。',
           finished_at = now(), updated_at = now()
     where id = v_rec.id and state in ('queued','processing');
    if found then
      perform public.release_credits(v_rec.user_id, v_rec.id);
      v_timed_out := v_timed_out + 1;
    end if;
  end loop;

  with pruned as (
    delete from public.generation_tasks
     where state in ('succeeded','failed','cancelled')
       and extract(epoch from (now() - coalesce(finished_at, updated_at))) * 1000 > p_retention_ms
     returning 1
  ) select count(*) into v_pruned from pruned;

  return jsonb_build_object(
    'timedOut', v_timed_out,
    'pruned',   v_pruned,
    'restored', public.restore_orphan_holds()
  );
end $$;

-- ============================================================================
-- 11) 函数执行权限：客户端（anon/authenticated，含 publishable key）不能调用
--     任何 SECURITY DEFINER 函数。10 个业务函数只授 service_role（服务器经
--     该角色 rpc，密钥只放服务端环境变量）。触发器函数 handle_new_auth_user
--     例外：它在 auth.users 插入时由平台角色 supabase_auth_admin（GoTrue 服务）
--     触发执行，revoke from public 之后必须显式授给该角色，否则注册会因权限
--     不足失败；它不需要授给 service_role（服务器从不直接调用它）。
-- ============================================================================
revoke execute on function public.handle_new_auth_user   from public, anon, authenticated;
revoke execute on function public.freeze_credits         from public, anon, authenticated;
revoke execute on function public.settle_credits         from public, anon, authenticated;
revoke execute on function public.release_credits        from public, anon, authenticated;
revoke execute on function public.restore_orphan_holds   from public, anon, authenticated;
revoke execute on function public.submit_generation_task from public, anon, authenticated;
revoke execute on function public.succeed_generation_task from public, anon, authenticated;
revoke execute on function public.fail_generation_task   from public, anon, authenticated;
revoke execute on function public.cancel_generation_task from public, anon, authenticated;
revoke execute on function public.save_generation_task   from public, anon, authenticated;
revoke execute on function public.reconcile_generation   from public, anon, authenticated;

grant execute on function public.handle_new_auth_user   to supabase_auth_admin;
grant execute on function public.freeze_credits         to service_role;
grant execute on function public.settle_credits         to service_role;
grant execute on function public.release_credits        to service_role;
grant execute on function public.restore_orphan_holds   to service_role;
grant execute on function public.submit_generation_task to service_role;
grant execute on function public.succeed_generation_task to service_role;
grant execute on function public.fail_generation_task   to service_role;
grant execute on function public.cancel_generation_task to service_role;
grant execute on function public.save_generation_task   to service_role;
grant execute on function public.reconcile_generation   to service_role;

-- ============================================================================
-- 12) username 唯一约束升级块：本脚本旧版本（v2.0）的 profiles 表没有唯一约束，
--     若此前已执行过旧脚本，本块负责：① 消歧历史重名（追加确定性后缀，只改
--     显示名、不删数据）；② 补建唯一约束。全新库由第 1 节建表语句自带约束，
--     本块检测到已存在即跳过。消歧 UPDATE 仅当约束缺失且存在重名时执行一次。
-- ============================================================================
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'profiles_username_key'
       and conrelid = 'public.profiles'::regclass
  ) then
    update public.profiles p
       set username = p.username || '-' || left(md5(p.id::text), 8)
     where exists (
       select 1 from public.profiles q
        where q.username = p.username and q.id < p.id
     );
    alter table public.profiles
      add constraint profiles_username_key unique (username);
  end if;
end $$;

-- 13) 回填：本脚本执行前已存在的 auth 用户（如面板手动创建的测试账号）。
--     完整性三步走（不允许静默遗漏任何用户）：
--       ① 首选名回填：同一邮箱前缀的多个用户按 id 排序，第一个保留前缀，
--          其余追加确定性后缀；on conflict do nothing 只挡「已有行」冲突
--          （含 id 冲突，即触发器已为其建过行的用户——保留原行不动）；
--       ② 修复循环：仍缺 profile 的用户改用「前缀-8 位哈希」确定性后缀补建
--          （与触发器消歧同策略），与既有用户名撞上的概率可忽略，仍撞则
--          下一轮重试，insert 行数为 0 时退出（不会死循环）；
--       ③ 完整性断言：任何 auth 用户都必须有 profile、任何 profile 都必须有
--          余额账户，缺一即 RAISE（整次迁移回滚），绝不静默跳过。
--     触发器路径（第 6 节）同样是「撞名重试、失败即报错」，无静默遗漏。
--     服务器惰性补建 ensureProfile 仍保留，作为运行时防御（见 credits-system.md）。
do $$
declare v_n integer;
begin
  -- ① 首选名回填
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

  -- ② 修复循环：仍有缺失的用户全部用确定性哈希后缀补建
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

  -- 余额账户：每个 profile 一个（演示初始 100）
  insert into public.credit_accounts (user_id)
    select id from public.profiles
    on conflict (user_id) do nothing;

  -- ③ 完整性断言：零遗漏
  if exists (
    select 1 from auth.users u
     where not exists (select 1 from public.profiles p where p.id = u.id)
  ) then
    raise exception '回填完整性检查失败：存在缺少 profile 行的 auth 用户';
  end if;
  if exists (
    select 1 from public.profiles p
     where not exists (select 1 from public.credit_accounts a where a.user_id = p.id)
  ) then
    raise exception '回填完整性检查失败：存在缺少余额账户的 profile';
  end if;
end $$;

-- ============================================================================
-- 14) 自动化结构自检（迁移成功的判定，不再只靠 if not exists）：
--     对表/列/类型/约束/索引/RLS/策略/函数属性/授权/触发器/默认权限逐项断言，
--     任何一项不符即 RAISE EXCEPTION → 整次执行回滚，不会留下「部分迁移」。
--     重新执行本脚本时同样运行，兼作回归检查；全部通过时输出一条 NOTICE
--     「迁移自检通过」。行为级验证另见 docs/supabase-integration-tests.sql。
-- ============================================================================
do $$
declare
  v_fail text[] := '{}';
  v_cnt integer;
  v_rec record;
  v_rel text;
  v_seq record;
begin
  -- ① 五张业务表存在
  for v_rel in select unnest(array[
    'profiles','credit_accounts','credit_holds','credit_ledger','generation_tasks'
  ]) loop
    select count(*) into v_cnt from information_schema.tables
     where table_schema = 'public' and table_name = v_rel;
    if v_cnt = 0 then v_fail := v_fail || ('缺少表 public.' || v_rel); end if;
  end loop;

  -- ② 关键列逐项存在
  for v_rec in
    select * from (values
      ('profiles','id'),('profiles','username'),('profiles','created_at'),
      ('credit_accounts','user_id'),('credit_accounts','balance'),
      ('credit_accounts','frozen'),('credit_accounts','updated_at'),
      ('credit_holds','id'),('credit_holds','user_id'),('credit_holds','task_id'),
      ('credit_holds','amount'),('credit_holds','created_at'),
      ('credit_ledger','id'),('credit_ledger','user_id'),('credit_ledger','op'),
      ('credit_ledger','amount'),('credit_ledger','ref'),('credit_ledger','created_at'),
      ('generation_tasks','id'),('generation_tasks','user_id'),
      ('generation_tasks','idempotency_key'),('generation_tasks','quality'),
      ('generation_tasks','cost'),('generation_tasks','simulate_failure'),
      ('generation_tasks','state'),('generation_tasks','saved'),
      ('generation_tasks','failure_code'),('generation_tasks','failure_message'),
      ('generation_tasks','result_svg'),('generation_tasks','created_at'),
      ('generation_tasks','updated_at'),('generation_tasks','finished_at')
    ) as e(tbl, col)
  loop
    select count(*) into v_cnt from information_schema.columns
     where table_schema = 'public' and table_name = v_rec.tbl and column_name = v_rec.col;
    if v_cnt = 0 then v_fail := v_fail || ('缺少列 public.' || v_rec.tbl || '.' || v_rec.col); end if;
  end loop;

  -- ③ 金额列类型必须为 numeric（禁止浮点）
  select count(*) into v_cnt from information_schema.columns
   where table_schema = 'public'
     and (table_name, column_name) in (
       ('credit_accounts','balance'), ('credit_accounts','frozen'),
       ('credit_holds','amount'), ('credit_ledger','amount'),
       ('generation_tasks','cost'))
     and data_type = 'numeric';
  if v_cnt < 5 then v_fail := v_fail || '金额列未全部使用 numeric（防浮点）'; end if;

  -- ④ 唯一约束与唯一索引（幂等/并发仲裁依赖）
  select count(*) into v_cnt from pg_constraint
   where conname = 'profiles_username_key' and contype = 'u'
     and conrelid = 'public.profiles'::regclass;
  if v_cnt = 0 then v_fail := v_fail || '缺少 profiles.username 唯一约束'; end if;
  select count(*) into v_cnt from pg_constraint
   where conrelid = 'public.generation_tasks'::regclass and contype = 'u';
  if v_cnt = 0 then v_fail := v_fail || '缺少 generation_tasks(user_id, idempotency_key) 唯一约束'; end if;
  for v_rel in select unnest(array[
    'credit_holds_task_once_idx','credit_ledger_settle_once_idx',
    'generation_tasks_one_active_idx'
  ]) loop
    select count(*) into v_cnt from pg_indexes
     where schemaname = 'public' and indexname = v_rel;
    if v_cnt = 0 then v_fail := v_fail || ('缺少唯一索引 ' || v_rel); end if;
  end loop;
  -- 租约查询索引（对账超时回收按 updated_at 扫描，必须有索引兜底）
  select count(*) into v_cnt from pg_indexes
   where schemaname = 'public' and indexname = 'generation_tasks_updated_idx';
  if v_cnt = 0 then v_fail := v_fail || '缺少租约索引 generation_tasks_updated_idx'; end if;
  -- 状态机一致性约束（租约/心跳语义的数据库级兜底，第 5 节）
  for v_rel in select unnest(array[
    'generation_tasks_state_finished_ck',
    'generation_tasks_result_state_ck',
    'generation_tasks_failure_state_ck'
  ]) loop
    select count(*) into v_cnt from pg_constraint
     where conname = v_rel and contype = 'c'
       and conrelid = 'public.generation_tasks'::regclass;
    if v_cnt = 0 then v_fail := v_fail || ('缺少状态机一致性约束 ' || v_rel); end if;
  end loop;

  -- ⑤ RLS 五表全部启用
  select count(*) into v_cnt
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('profiles','credit_accounts','credit_holds','credit_ledger','generation_tasks')
     and c.relrowsecurity;
  if v_cnt < 5 then v_fail := v_fail || '存在未启用 RLS 的业务表'; end if;

  -- ⑥ 策略：五条 select 策略存在，且零写策略
  select count(*) into v_cnt from pg_policies
   where schemaname = 'public'
     and (tablename, policyname) in (
       ('profiles','profiles_select_own'),
       ('credit_accounts','credit_accounts_select_own'),
       ('credit_holds','credit_holds_select_own'),
       ('credit_ledger','credit_ledger_select_own'),
       ('generation_tasks','generation_tasks_select_own'));
  if v_cnt < 5 then v_fail := v_fail || 'select 策略缺失（应恰好 5 条）'; end if;
  select count(*) into v_cnt from pg_policies
   where schemaname = 'public'
     and tablename in ('profiles','credit_accounts','credit_holds','credit_ledger','generation_tasks')
     and cmd <> 'select';
  if v_cnt > 0 then v_fail := v_fail || '存在越权的写策略（应零写策略）'; end if;

  -- ⑦ 函数属性：11 个函数全部 plpgsql、SECURITY DEFINER、属主 postgres
  select count(*) into v_cnt
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_roles r on r.oid = p.proowner
    join pg_language l on l.oid = p.prolang
   where n.nspname = 'public'
     and p.proname in (
       'handle_new_auth_user','freeze_credits','settle_credits','release_credits',
       'restore_orphan_holds','submit_generation_task','succeed_generation_task',
       'fail_generation_task','cancel_generation_task','save_generation_task',
       'reconcile_generation')
     and p.prokind = 'f' and p.prosecdef
     and r.rolname = 'postgres' and l.lanname = 'plpgsql';
  if v_cnt < 11 then
    v_fail := v_fail || '函数属性不符（应 11 个 plpgsql SECURITY DEFINER 且属主 postgres）';
  end if;

  -- ⑧ 函数授权（最小权限）：10 个业务函数仅 service_role 可执行；
  --    触发器函数仅 supabase_auth_admin 可执行；客户端角色一律不可
  for v_rec in
    select * from (values
      ('freeze_credits(uuid,numeric,text)'),
      ('settle_credits(uuid,text)'),
      ('release_credits(uuid,text)'),
      ('restore_orphan_holds()'),
      ('submit_generation_task(uuid,text,text,text,numeric,boolean)'),
      ('succeed_generation_task(uuid,text,text)'),
      ('fail_generation_task(uuid,text,text,text)'),
      ('cancel_generation_task(uuid,text)'),
      ('save_generation_task(uuid,text)'),
      ('reconcile_generation(bigint,bigint)')
    ) as f(sig)
  loop
    if not has_function_privilege('service_role', 'public.' || v_rec.sig, 'execute') then
      v_fail := v_fail || ('service_role 缺少执行权限：' || v_rec.sig);
    end if;
    if has_function_privilege('anon', 'public.' || v_rec.sig, 'execute')
       or has_function_privilege('authenticated', 'public.' || v_rec.sig, 'execute') then
      v_fail := v_fail || ('客户端角色越权可执行：' || v_rec.sig);
    end if;
  end loop;
  if not has_function_privilege('supabase_auth_admin', 'public.handle_new_auth_user()', 'execute') then
    v_fail := v_fail || 'supabase_auth_admin 缺少 handle_new_auth_user 执行权限（注册会失败）';
  end if;
  if has_function_privilege('anon', 'public.handle_new_auth_user()', 'execute')
     or has_function_privilege('authenticated', 'public.handle_new_auth_user()', 'execute') then
    v_fail := v_fail || '客户端角色越权可执行 handle_new_auth_user';
  end if;

  -- ⑨ 注册触发器存在
  select count(*) into v_cnt from pg_trigger
   where tgrelid = 'auth.users'::regclass
     and tgname = 'on_auth_user_created' and not tgisinternal;
  if v_cnt = 0 then v_fail := v_fail || '缺少 auth.users 注册触发器 on_auth_user_created'; end if;

  -- ⑩ 表级授权：anon 零权限；authenticated 仅 select（无任何写权限）
  for v_rel in select unnest(array[
    'profiles','credit_accounts','credit_holds','credit_ledger','generation_tasks'
  ]) loop
    if has_table_privilege('anon', 'public.' || v_rel, 'select')
       or has_table_privilege('anon', 'public.' || v_rel, 'insert')
       or has_table_privilege('anon', 'public.' || v_rel, 'update')
       or has_table_privilege('anon', 'public.' || v_rel, 'delete')
       or has_table_privilege('anon', 'public.' || v_rel, 'truncate') then
      v_fail := v_fail || ('anon 越权访问 public.' || v_rel);
    end if;
    if has_table_privilege('authenticated', 'public.' || v_rel, 'insert')
       or has_table_privilege('authenticated', 'public.' || v_rel, 'update')
       or has_table_privilege('authenticated', 'public.' || v_rel, 'delete')
       or has_table_privilege('authenticated', 'public.' || v_rel, 'truncate') then
      v_fail := v_fail || ('authenticated 越权写入 public.' || v_rel);
    end if;
    if not has_table_privilege('authenticated', 'public.' || v_rel, 'select') then
      v_fail := v_fail || ('authenticated 缺少只读权限 public.' || v_rel);
    end if;
  end loop;
  if has_schema_privilege('anon', 'public', 'create')
     or has_schema_privilege('authenticated', 'public', 'create') then
    v_fail := v_fail || '客户端角色仍可在 public schema 建对象';
  end if;

  -- ⑩续：身份列序列不得向客户端授权（序列不随表授权收回，第 8 节已显式 revoke）
  for v_seq in
    select c.oid as seq_oid from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     join pg_depend d on d.objid = c.oid and d.deptype in ('i','a')
     join pg_class t on t.oid = d.refobjid
     join pg_namespace tn on tn.oid = t.relnamespace
    where n.nspname = 'public' and c.relkind = 'S'
      and tn.nspname = 'public'
      and t.relname in ('profiles','credit_accounts','credit_holds',
                        'credit_ledger','generation_tasks')
  loop
    if has_sequence_privilege('anon', v_seq.seq_oid, 'usage')
       or has_sequence_privilege('anon', v_seq.seq_oid, 'select')
       or has_sequence_privilege('authenticated', v_seq.seq_oid, 'usage')
       or has_sequence_privilege('authenticated', v_seq.seq_oid, 'select') then
      v_fail := v_fail || ('序列越权：' || v_seq.seq_oid::regclass::text);
    end if;
  end loop;

  -- ⑪ 默认权限（两级并集，第 9 节）：postgres 新建对象不再授 anon/authenticated；
  --     新建函数/序列不再默认授 PUBLIC。内建默认（新函数默认授 PUBLIC
  --     EXECUTE）与平台默认授权都是全局级（defaclnamespace = 0），按 schema
  --     的 REVOKE 撤销不了它们，所以第 9 节在全局级与 public 的 schema 级
  --     两层都做了撤销声明——本断言按两级并集检查。
  select count(*) into v_cnt from pg_default_acl d
   where d.defaclnamespace in (0, 'public'::regnamespace)
     and d.defaclrole = (select oid from pg_roles where rolname = 'postgres')
     and d.defaclobjtype in ('r','S','f')
     and exists (
       select 1 from aclexplode(d.defaclacl) a
        where a.grantee in (select oid from pg_roles where rolname in ('anon','authenticated')));
  if v_cnt > 0 then v_fail := v_fail || '默认权限仍向 anon/authenticated 暴露新建对象'; end if;
  select count(*) into v_cnt from pg_default_acl d
   where d.defaclnamespace in (0, 'public'::regnamespace)
     and d.defaclrole = (select oid from pg_roles where rolname = 'postgres')
     and d.defaclobjtype in ('f','S')
     and exists (
       select 1 from aclexplode(d.defaclacl) a
        where a.grantee = 0 and a.privilege_type in ('EXECUTE','USAGE','SELECT'));
  if v_cnt > 0 then v_fail := v_fail || '默认权限仍向 PUBLIC 授函数/序列权限'; end if;

  -- ⑫ 最终生效授权实建验证（探针）：pg_default_acl 只描述规则，探针直接验证
  --     实际生效的默认授权。探针对象为本事务内实建即删，不残留；断言失败时
  --     整个事务回滚，同样零残留。
  drop function if exists public.__selfcheck_probe_fn();
  drop table if exists public.__selfcheck_probe_t;
  drop sequence if exists public.__selfcheck_probe_seq;
  create function public.__selfcheck_probe_fn() returns integer
  language sql as 'select 1';
  create table public.__selfcheck_probe_t (id integer);
  create sequence public.__selfcheck_probe_seq;

  if has_function_privilege('anon', 'public.__selfcheck_probe_fn()', 'execute')
     or has_function_privilege('authenticated', 'public.__selfcheck_probe_fn()', 'execute') then
    v_fail := v_fail || '探针函数仍向客户端角色授 EXECUTE（默认权限未生效）';
  end if;
  select count(*) into v_cnt from pg_proc
   where pronamespace = 'public'::regnamespace and proname = '__selfcheck_probe_fn'
     and exists (
       select 1 from aclexplode(proacl) a
        where a.grantee = 0 and a.privilege_type = 'EXECUTE');
  if v_cnt > 0 then v_fail := v_fail || '探针函数仍默认授 PUBLIC EXECUTE'; end if;

  if has_table_privilege('anon', 'public.__selfcheck_probe_t', 'select')
     or has_table_privilege('anon', 'public.__selfcheck_probe_t', 'insert')
     or has_table_privilege('authenticated', 'public.__selfcheck_probe_t', 'select') then
    v_fail := v_fail || '探针表仍向客户端角色授权（默认权限未生效）';
  end if;
  if not has_table_privilege('service_role', 'public.__selfcheck_probe_t', 'select') then
    v_fail := v_fail || '探针表未保留 service_role 默认授权（服务器直读会被阻断）';
  end if;

  if has_sequence_privilege('anon', 'public.__selfcheck_probe_seq', 'usage')
     or has_sequence_privilege('anon', 'public.__selfcheck_probe_seq', 'select')
     or has_sequence_privilege('authenticated', 'public.__selfcheck_probe_seq', 'usage')
     or has_sequence_privilege('authenticated', 'public.__selfcheck_probe_seq', 'select') then
    v_fail := v_fail || '探针序列仍向客户端角色授权（默认权限未生效）';
  end if;
  select count(*) into v_cnt from pg_class
   where oid = 'public.__selfcheck_probe_seq'::regclass
     and exists (
       select 1 from aclexplode(relacl) a
        where a.grantee = 0 and a.privilege_type in ('USAGE','SELECT'));
  if v_cnt > 0 then v_fail := v_fail || '探针序列仍默认授 PUBLIC'; end if;

  -- 探针清理：正常路径显式删除；断言失败路径由 RAISE 回滚整个事务
  drop sequence if exists public.__selfcheck_probe_seq;
  drop table if exists public.__selfcheck_probe_t;
  drop function if exists public.__selfcheck_probe_fn();

  if coalesce(array_length(v_fail, 1), 0) > 0 then
    raise exception '迁移自检失败（共 % 项）：%', array_length(v_fail, 1), array_to_string(v_fail, '；');
  end if;
  raise notice '✓ 迁移自检通过：5 表 / 关键列 / numeric 金额 / 约束与索引（含状态机一致性）/ RLS / 策略 / 11 函数属性 / 授权 / 触发器 / 默认权限（规则断言 + 实建探针验证最终生效授权）全部符合预期';
end $$;

-- ============================================================================
-- 15) 人工冒烟（无法自动化的项，第 14 节自检通过后执行）：
--   1) 真实注册路径：面板 Authentication → Users → Add user 手动创建测试用户，
--      再核对 profiles 新增一行、credit_accounts 余额为 100（验证
--      supabase_auth_admin 触发路径与第 11 节的触发器授权）。
--   2) 重复执行安全：整脚本重跑一遍应零报错（含自检 NOTICE），业务数据行数不变。
--   3) 行为级验证：执行 docs/supabase-integration-tests.sql（冻结→结算、
--      失败→释放、重复提交、成功与取消竞争、并发结算与孤儿恢复、租约心跳
--      边界、数据库断连、注册回填、参数校验等真实 PostgreSQL 集成测试）。
--   4) APP_MODE=production 冒烟：配置三个 Supabase 环境变量后重启服务，
--      /api/auth/me 应 200，Credits/任务接口应可用（迁移后不再 503）。
--   5) demo 模式不受影响：不设 APP_MODE 时行为与迁移前完全一致（不连数据库）。
-- ============================================================================
