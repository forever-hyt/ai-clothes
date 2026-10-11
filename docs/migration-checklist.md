# Supabase 迁移前检查清单（docs/migration-checklist.md）

配合 docs/supabase-schema.sql **v2.2（迁移前终审版）** 与 docs/supabase-integration-tests.sql **v1.2**。2026-10-10 交付（含独立审查第二、三轮修复），**等待确认——确认前不执行任何数据库 SQL**。

## A. 终审要求 + 独立审查发现的落实情况

| # | 要求 | 落实 |
|---|---|---|
| 1 | 重新评估 ALTER DEFAULT PRIVILEGES 作用范围 | 收窄为只声明 **postgres**（本项目唯一会创建对象的角色：SQL Editor 与迁移均以其执行）。**移除**对 supabase_admin / service_role / authenticator 平台角色默认权限的全部修改——它们的默认 ACL 管理平台自身对象（扩展、内部表）的授权，与本项目无关。**第三轮审查修正了层级语义理解**：schema 级默认条目是叠加在全局级之上，按 schema 的 REVOKE **撤销不了全局已授予的默认权限**（含内建默认：新函数默认授 PUBLIC EXECUTE，属全局级；平台为 postgres 配置的 anon/authenticated 默认授权也在全局级）——因此撤销改为**全局声明 + public schema 级声明双层撤销**（两级是叠加生效的，撤销必须两层都做：tables/sequences/functions 两级均 revoke anon、authenticated；functions/sequences 两级另 revoke PUBLIC）。service_role 的默认授权（ALL）保留（服务器直读账本表所需）。最终有效授权由第 14 节自检**实建探针对象**直接验证（函数/表/序列三探针 + service_role 保留断言，实建即删零残留），不再只查 pg_default_acl；另补收身份列序列的存量授权。 |
| 2 | 业务表/函数/RLS/授权最小权限 | 表：anon 零权限（连 select 都收回）、authenticated 仅 select，insert/update/delete/truncate/references/trigger 全部显式收回；RLS：五表全启用、仅「读自己行」、**零写策略**（自检断言）；函数：10 个业务函数仅授 service_role；**触发器函数仅授实际触发它的 supabase_auth_admin**（终审修复项，见下）；对 public/anon/authenticated 一律 revoke；另收回客户端在 public schema 的 CREATE。 |
| 3 | 数据库结构验证，不只靠 IF NOT EXISTS | 第 14 节**自动化结构自检** DO 块：表存在性、33 个关键列、numeric 金额类型、唯一约束/唯一索引 + 租约索引 + **三条状态机一致性 CHECK 约束**、RLS 启用、策略存在性与零写策略、11 个函数属性（plpgsql/SECURITY DEFINER/属主 postgres）、函数授权（service_role 可执行、客户端不可）、触发器存在、表级授权、pg_default_acl。任何一项不符即 RAISE EXCEPTION → 整次迁移回滚，不存在「部分迁移被当作成功」。回填完整性（每个 auth 用户有 profile、每个 profile 有账户）由第 13 节末尾断言兜底。 |
| 4 | 真实 PostgreSQL 集成测试 | docs/supabase-integration-tests.sql **v1.2**：冻结→结算（先结果后扣费、重复结算幂等）、失败→释放、取消→释放、**重复提交**（同键重发/重放只冻结一次）、**并发结算与孤儿恢复**（restore→settle / settle→restore 两种先后顺序单会话验证；附录 B 双会话真实竞态为**待验证项**）、**成功与取消竞争**（单会话确定性交错；附录 A 双会话真实竞态为**待验证项**）、**任务超时与租约/心跳边界**（59s 不回收 / 61s 回收，长任务在租约内绝不误收）、孤儿冻结恢复、**数据库断连**（子事务回滚等价断连：零残留 + 重试幂等恢复）、**用户注册回填**（缺资料用户补建、撞名哈希后缀、资料+账户零遗漏断言；不再禁用注册触发器，回填前有非测试用户防护断言）、参数校验与非法状态（NULL/超大金额/非法质量零副作用）、触发器建号。**文件自带 begin/commit 事务边界**（不依赖执行工具自动包事务），失败整体回滚、零残留。 |
| 5 | 保留演示模式、不启用支付 | 本迁移只服务 APP_MODE=production；demo 不连数据库、行为不变（清单 §C 第 7 步有验证项）。SQL 无任何支付表/支付函数，注册赠送 100 Credits 注释仍标注「仅开发测试，不代表真实付费额度」。 |
| 6 | 暂不启用 pg_cron | SQL 中 pg_cron 仅以注释存在，已标注「暂不启用，仅注释」；全文无 `create extension`、无 `cron.schedule` 执行。多实例部署需联调完成后再单独配置。 |
| 7 | 不执行 SQL、不部署 Render、不恢复公网 | 本次交付只修改本地文件；未执行任何数据库 SQL，未部署，未恢复公网服务。§C 的步骤均在**你确认之后**才可执行。 |

## B. 终审 + 独立审查发现并已修复的问题（v2.1 → v2.2）

1. **触发器授权缺陷（会导致注册失败）**：v2.1 对 handle_new_auth_user `revoke from public` 后只授了 service_role。但该函数由平台角色 **supabase_auth_admin**（GoTrue 写入 auth.users）触发执行，revoke public 后若无显式授权，注册会因权限不足失败。v2.2 改为授 supabase_auth_admin（不授 service_role——服务器从不直接调用它），并加入自检断言。
2. **默认权限作用范围过宽**：v2.1 修改了 4 个角色的默认 ACL，其中 3 个是平台角色，可能影响我们不拥有的对象。v2.2 只保留 postgres（并核对全局/schema 两级默认的关系，见 §A 第 1 行）。
3. **头部说明与正文编号漂移**：v2.1 头部「第 11 节幂等回填 / 第 10 节消歧 UPDATE」与正文实际编号（12/13）不符，v2.2 已校正。
4. **自检靠人工核对**：v2.1 的 8 条自检需人工逐条运行比对；v2.2 升级为自动化断言（第 14 节），无法自动化的保留在第 15 节人工冒烟。
5. **restore_orphan_holds 并发竞态（审查问题 1）**：v2.1 恢复孤儿冻结时不加锁，与 settle/release 并发可能重复更新余额（结算后又恢复、释放后又恢复）。v2.2 改为逐行 `for update skip locked` 锁定冻结行 + 锁定后重新验证任务状态；锁序与 settle/release 一致（先冻结行、后账户行），三者只可能一方生效。
6. **succeed 未确认结算（审查问题 2）**：v2.1 在冻结记录缺失时仍把任务置 succeeded 并返回 true（免费结果）。v2.2 让 settle_credits 返回 boolean，succeed 在结算未真实发生时 RAISE 回滚——任务保持 processing、不落地 succeeded，随后由对账租约回收；集成测试第 8 节覆盖。
7. **回填静默遗漏用户（审查问题 4）**：v2.1 回填 `on conflict do nothing` 可能整体跳过撞名用户（无 profile、无账户）。v2.2 升级为「首选名 + 哈希后缀修复循环 + 完整性断言」三步：任何 auth 用户必须有 profile、任何 profile 必须有账户，缺一即 RAISE 整次回滚；撞名只影响显示名。集成测试第 11 节覆盖（触发器禁用建号 + 撞名修复 + 零遗漏断言）。
8. **参数校验缺失（审查问题 7）**：v2.1 未拦截 NULL 用户/质量/金额与超大金额（PostgreSQL 的 CHECK 对 NULL 恒真，只靠约束会放行 NULL quality 的行）。v2.2 全部写路径函数入口显式校验：NULL、空键、非法质量、金额 ≤0 或 > 9999999999.99（与 numeric(12,2) 容量对齐）一律返回 invalid/false/notFound，零副作用；集成测试第 9 节覆盖。
9. **租约/心跳缺数据库级一致性兜底（审查问题 5）**：v2.2 为 generation_tasks 增加三条状态机一致性 CHECK 约束（活动任务 finished_at 必须为空、终态必有 finished_at、result_svg/failure_code 与状态联动），自检断言约束与租约索引存在，集成测试第 7 节验证租约边界（59s 不回收 / 61s 回收 / 长任务在租约内绝不误收）。
10. **默认权限层级语义理解错误（第三轮审查问题 1）**：v2.2 曾断言「schema 级条目覆盖全局级」，并用按 schema 的 REVOKE 撤销平台全局默认授权——按 PostgreSQL 官方语义该撤销**无效**（schema 级 REVOKE 只能撤销 schema 级 GRANT）。v2.2 改为**全局级 + public schema 级双层撤销**（两级叠加生效，撤销必须两层都做），并在第 14 节自检新增「实建探针」验证最终生效授权（含 service_role 保留断言），另补收身份列序列的存量授权。
11. **集成测试第 6 组余额断言错误（第三轮审查问题 2/5）**：原断言 A 结算 + B 取消后余额 96/0，数学应为 **98/0**（A 净扣 2、B 冻结后退还净零）。已修正并逐组复核全部余额断言（其余各组与账本一致），复核明细见本次交付报告。
12. **事务边界依赖执行工具（第三轮审查问题 3）**：测试文件此前假设执行环境自动把全文包成单事务。v1.2 改为**文件自带 begin/commit**（助手函数之后 begin、清理之后 commit），psql 执行不加 --single-transaction；SQL Editor 包事务/逐语句两种语义下均正确。另加同会话重跑兼容（create or replace / drop table if exists）。
13. **测试隔离不足（第三轮审查问题 4）**：v1.1 第 11 节禁用 auth.users 注册触发器并全量回填，可能影响共享项目。v1.2 不再禁用触发器（改用删除测试用户触发建号的行来构造「缺资料」状态，对并发注册零影响）；回填前加防护断言（检测到将向非测试用户写入即报错终止）；完整性断言只覆盖测试用户；文件头要求隔离测试环境（专用项目/Preview Branch/本地容器），并标注不得在生产项目运行。
14. **未执行的双会话竞态被当作已覆盖（第三轮审查问题 6）**：附录 A/B 双会话竞态从未在任何环境实际执行过。v1.2 明确标注【待验证】，§C 第 4 步列为迁移后的待执行项；本清单与交付报告均不再声称已通过真实并发验证。

## C. 迁移执行步骤（确认后按序执行）

1. 打开目标 Supabase 项目 → SQL Editor，粘贴 docs/supabase-schema.sql v2.2 全文 → Run。
   **预期**：最后一条输出 `NOTICE: ✓ 迁移自检通过：…`，无任何报错。任何异常 → 整次回滚，修复后重跑。
2. 人工冒烟 1（真实注册路径）：面板 Authentication → Users → Add user 建一个测试用户 → 核对 `public.profiles` 新增一行、`public.credit_accounts` 该用户 balance = 100（验证 supabase_auth_admin 触发路径与授权）。
3. 执行 docs/supabase-integration-tests.sql **v1.2**（隔离测试环境；psql 推荐：`psql -v ON_ERROR_STOP=1 -f`，**不加 --single-transaction**——文件自带 begin/commit；SQL Editor 全量粘贴亦可）。**预期**：11 条 PASS + 1 条「全部集成测试通过」NOTICE，零报错；失败时 psql 停在未完成事务上，执行 `rollback;` 即恢复干净。
4. **（待验证项，迁移后人工执行）** 集成测试附录 A（succeed vs cancel）与附录 B（restore vs settle）：双会话真实竞态，按附录步骤在隔离环境执行并核对不变量全部为 true。本清单交付时未声称已通过真实并发验证。
5. 人工冒烟 2（重复执行安全）：把 schema 脚本**整份重跑一遍** → 零报错（含自检 NOTICE）、业务数据行数不变。
6. 服务端配置：三个 Supabase 环境变量（NEXT_PUBLIC_SUPABASE_URL、NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY、SUPABASE_SERVICE_ROLE_KEY——service_role 只放服务端环境变量）+ `APP_MODE=production`，重启服务 → `/api/auth/me` 返回 200（authMode: supabase），Credits/任务接口不再 503。
7. 验证 demo 不受影响：不设 APP_MODE 重启 → 行为与迁移前完全一致（内存账本、不连数据库）。

## D. 迁移后注意

- pg_cron 仍不启用；多实例部署前再按 SQL 注释配置（需先 `create extension`）。
- 不接入支付；Credits 与 `simulated: true` 标注保持，注册赠送 100 点上线前移除（docs/credits-system.md §7.6）。
- 生产密钥轮换、日志不落敏感信息等公网部署要求见 README「公网部署边界」。
- 集成测试若因本项目策略无法直写 auth.users，按测试文件头部注释改用面板建号方案。
- 集成测试应在隔离测试环境运行（专用测试项目 / Supabase Preview Branch / 本地 supabase CLI 容器），不要在生产项目上运行；第 11 节防护会拦截向真实用户的写入。
