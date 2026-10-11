# 演示 Credits 计费与任务系统（docs/credits-system.md）

本文档描述工作台的演示 Credits 计费闭环（冻结 → 结算 / 释放 → 对账）与生成任务状态机，并给出接入真实数据库（Supabase PostgreSQL）时的迁移路径。实现见 `app/server/credits.ts`、`app/server/tasks.ts`、`app/api/[...segments]/route.ts`、`app/pricing.ts`；界面见四个分区组件与 `app/studio-client.tsx`。

## 1. 边界声明（演示版）

- **演示账本**：Credits 存于进程内存（`globalThis` 挂载的 Map），**重启即重置**，不涉及真实资金。
- **单进程**：互斥锁与对账循环都在单进程内；多实例部署不共享账本，会产生重复扣费风险，生产必须换成数据库事务（见 §7）。
- **明确标注**：所有余额接口返回 `simulated: true`；界面标注“演示 Credits · 内存记账，重启即重置，不涉及真实资金”。未接入任何支付服务商。
- 生成结果仅为内置插画合成的演示搭配板，带 SIMULATION 水印，标注“非真实 AI 结果”。

## 2. 数据模型与不变量

每个用户一份账本：`balance`（可用）、`frozen`（冻结中）、`freezes`（冻结明细：金额 + 引用任务 id）、`journal`（流水日志，上限 200 条）。

| 不变量 | 说明 |
|---|---|
| `balance >= 0` | 余额不足时整个提交回滚（402），不冻结、不建任务 |
| `frozen = Σ freezes` | 冻结明细与总额一致 |
| 先冻结后生成 | 提交与冻结在同一个 `locked()` 临界区内完成 |
| 先落结果后结算 | 结果写入任务记录（可下载）之后才结算（settle），顺序保证“确认可下载，再扣费” |
| 失败/取消/超时必释放 | 三条路径都释放冻结并记 release 流水 |
| 结算只发生一次 | `completeTask` 对重复回调幂等（状态检查拦截）；结算以任务 id 去重 |
| 孤儿冻结可回收 | 对账时对“有冻结但无存活任务”的明细恢复（restore 流水） |
| (user, idempotencyKey) 唯一 | 同一提交的重复请求返回原任务，不重复冻结、不重复扣费 |

`locked()`（promise 链互斥）是**演示版的事务边界**：所有账本读写都在临界区内串行执行。生产环境必须替换为数据库事务（§7）。

## 3. 任务状态机

```
queued → processing → succeeded | failed | cancelled
```

- 提交：`POST /api/generate` 在临界区内完成幂等检查、活动任务检查、任务创建与冻结；余额不足整体回滚。
- 排队/生成时长由 `DEMO_SIM_QUEUE_MS`（默认 800ms）与 `DEMO_SIM_PROCESS_MS`（默认 2500ms）模拟。
- `completeTask` 是“提供方回调”入口：provider 抛异常也会兜底为 failed(PROVIDER_ERROR) 并释放冻结。
- 客户端轮询 `GET /api/tasks/:id`；刷新/重新登录后经 `GET /api/tasks/active` 恢复；POST 响应丢失时经 `GET /api/tasks/by-key/:key` 找回，找不到则用同一幂等键重发（服务端幂等返回 reused）。
- 同一用户同一时间只允许一个活动任务（第二个提交返回 409 + 进行中的任务）。

**对账**（`reconcileNow`，30s 周期，`DEMO_RECONCILE_MS`）：

1. 卡在 queued/processing 超过 `DEMO_TASK_TIMEOUT_MS`（默认 60s）→ failed(TIMEOUT) + 释放冻结；
2. 终态任务超过保留期 `DEMO_TASK_RETENTION_MS`（默认 30 分钟，契合隐私清理策略）→ 删除任务、结果与 by-key 映射；
3. 孤儿冻结（有冻结无存活任务）→ 恢复余额并记 restore 流水。

对账循环用 `globalThis` 防重入（dev 热重载不叠加），定时器 unref，不阻止进程退出。生产多实例对账必须用外部任务队列/定时任务（§7）。

## 4. API 一览

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/generate` | 提交演示生成。请求：`{privacyConsent, safetyConsent, serverConsent, quality: 'standard'\|'hd', idempotencyKey: uuid, simulateFailure?, source: 'demo'}`。201 新建 / 200 幂等复用 `{task, credits}`；402 余额不足 `{error, code: INSUFFICIENT_CREDITS, credits}`；409 有活动任务 `{error, code: TASK_IN_PROGRESS, task}` |
| GET | `/api/tasks/:id` | 任务状态 `{task}`（不含结果内容） |
| GET | `/api/tasks/:id/result` | 结果图片（SVG，CSP sandbox + nosniff）；`?download=1` 触发附件下载。未完成 409，无结果 410 |
| GET | `/api/tasks/active` | 当前活动任务 `{task\|null, credits}`（断线/刷新恢复） |
| GET | `/api/tasks/by-key/:uuid` | 按幂等键查任务 `{task, credits}`；不存在 404 TASK_NOT_FOUND |
| POST | `/api/tasks/:id/save` | 保存作品（内存标记）。仅 succeeded 可保存，否则 409 RESULT_NOT_READY |
| POST | `/api/tasks/:id/cancel` | 取消活动任务并释放冻结；非活动 409 TASK_NOT_ACTIVE |
| GET | `/api/credits/balance` | `{balance, frozen, simulated: true}` |
| GET | `/api/credits/ledger` | `{balance, frozen, simulated, entries}`，流水倒序最多 50 条：`{op: freeze\|settle\|release\|restore, amount, ref, at}` |

错误码：INSUFFICIENT_CREDITS / TASK_IN_PROGRESS / TASK_NOT_FOUND / RESULT_NOT_READY / RESULT_GONE / TASK_NOT_ACTIVE / INVALID_QUALITY / INVALID_KEY / INVALID_SOURCE / RATE_LIMITED / AUTH_REQUIRED。全部接口需登录（401），POST 有同源校验，生成接口限流 `DEMO_GENERATE_RATE`（默认 5 次/分钟）。

## 5. 幂等键约定

- 客户端每次**显式提交/重试/重新生成**生成**新** UUID-v4（`crypto.randomUUID`，非安全上下文有 getRandomValues 兜底）。
- **自动恢复复用旧键**：POST 响应丢失（超时/断网）→ 先 `by-key` 查询；找不到（服务器没收到）→ 用**同一键**重发，服务端幂等返回原任务。
- 幂等键只在演示会话内有效：任务超过保留期被清理后，by-key 映射一并删除（重发旧键会创建新任务——但该场景已被“先查询再重发”覆盖）。

## 6. 环境变量（DEMO_*，均可省略）

| 变量 | 默认 | 说明 |
|---|---|---|
| `DEMO_CREDITS_INITIAL` | 100 | 每个用户的初始演示余额 |
| `DEMO_SIM_QUEUE_MS` | 800 | 排队时长（提交时读取） |
| `DEMO_SIM_PROCESS_MS` | 2500 | 生成时长（提交时读取） |
| `DEMO_TASK_TIMEOUT_MS` | 60000 | 活动任务超时回收阈值 |
| `DEMO_TASK_RETENTION_MS` | 1800000 | 终态任务保留期（30 分钟） |
| `DEMO_RECONCILE_MS` | 30000 | 对账循环间隔（模块加载时读取） |
| `DEMO_GENERATE_RATE` | 5 | 生成接口每分钟限流次数 |

production 模式的环境变量（APP_MODE、SUPABASE_*、RECONCILE_MS）见 §7.1。

## 7. 生产路径（Supabase Auth + PostgreSQL，代码已实现、迁移待执行）

演示版按“数据库可替换”设计，`locked()` 是事务边界占位，对账循环是 worker 占位。production 模式的代码路径已实现（`app/server/db/*`、`app/lib/supabase/*`、`app/server/storage.ts` 门面），但**数据库迁移 docs/supabase-schema.sql（v2.2，迁移前终审版）尚未执行**——在迁移执行前，production 模式的 Credits 与任务接口一律返回 503 `DB_UNAVAILABLE`，绝不回退内存账本，也不声称真实存储可用。执行步骤与前提见 docs/migration-checklist.md。

### 7.1 APP_MODE 与环境变量

- 不设置或 `APP_MODE=demo`：内存演示（默认，行为与本文第 1-6 节一致）。
- `APP_MODE=production`：要求 `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`（公开）与 `SUPABASE_SERVICE_ROLE_KEY`（仅服务端）全部为真实值。模式值非法或配置缺失 → 接口一律 503 `CONFIG_ERROR`；数据库不可用 → 503 `DB_UNAVAILABLE`。两种失败都不回退 demo。
- 模式在 `app/server/storage.ts` 模块加载时解析一次（改环境需重启；dev 热更不重解析，文档已注明）。

### 7.2 客户端分层与密钥边界

| 客户端 | 文件 | 密钥 | 用途 |
|---|---|---|---|
| Browser | app/lib/supabase/client.ts | publishable（公开） | 注册 / 登录 / 退出（Supabase Auth） |
| Server | app/lib/supabase/server.ts | publishable | 每请求 `auth.getUser()` 服务端身份校验（token 过期自动续期并写回 Cookie） |
| Admin | app/lib/supabase/admin.ts | service_role（仅服务端） | 账本/任务读写与全部 RPC；SQL 中 SECURITY DEFINER 函数的唯一授权角色 |

浏览器对账本零写权限（RLS 只读自身 + 表级撤销），所有 Credits 操作都在服务端完成；`service_role` 密钥绝不进 NEXT_PUBLIC_、绝不下发浏览器，静态边界由 tests/security-boundary.test.mjs 兜底。「未登录」（401）与「数据库不可达」（503）严格区分：getUser 的 `AuthSessionMissingError` 之外的一切错误都按数据库不可用处理。

### 7.3 数据库存储接口（RPC 即事务）

表：`profiles`、`credit_accounts`、`credit_holds`、`credit_ledger`、`generation_tasks`。**唯一权威定义是 docs/supabase-schema.sql（v2.2）**，本文件早期的 DDL 草图已被其取代。要点不变：金额一律 `numeric`；提交 = 插入任务 + 冻结同事务（幂等键与「每人一个活动任务」由唯一索引仲裁）；结算 = 结果先落库再 `INSERT credit_ledger(op='settle')`（唯一索引保证只结算一次）+ 删 hold + 退冻结；失败/取消/超时对称释放。

服务端 RPC 一览（`app/server/db/*` 调用，均 SECURITY DEFINER、仅 service_role 可执行）：

- `submit_generation_task` → 返回 `created:<id> | reused:<id> | inProgress:<id> | insufficient | invalid`（解析见 app/server/db/helpers.ts）；入口显式校验 NULL/非法质量/超大金额（> numeric(12,2) 容量），非法输入零副作用；
- `succeed_generation_task` / `fail_generation_task`（状态检查幂等，只对 processing 生效）；`settle_credits` 返回 boolean，succeed 在结算未真实发生（冻结记录缺失）时 RAISE 回滚——任务绝不带着未扣费的状态落地 succeeded（保持 processing，由对账租约回收）；
- `cancel_generation_task` / `save_generation_task` / `reconcile_generation`；`restore_orphan_holds` 逐行 `for update skip locked` 锁定冻结并复验任务状态，与结算/释放并发时只可能一方生效。

注册用户惰性补建：首次请求时服务端 `ensureProfile` 补建 profile 与余额账户（username 先试邮箱前缀，撞唯一约束退到「前缀-8 位哈希」确定性后缀，与 SQL 触发器/回填同一策略，重试收敛）。

### 7.4 心跳 / 租约（超时机制）

- 活动任务（queued / processing）由本进程每 **10 秒**刷新一次 `updated_at`（心跳）。
- 对账超时阈值（默认 **60 秒**，6 个心跳）即**租约期限**：进程崩溃或热重载丢失定时器后心跳停止 → 租约过期 → `reconcile_generation` 回收任务并退还冻结——绝不误收未完成任务的费用。刷新页面、断线重查、重启后首个请求都会经 `adopt()` 重新接续推进与心跳。
- 提供方结果先缓存在内存（pendingOutcomes），结算 RPC 失败（数据库瞬时中断）时随每个心跳重试；succeed/fail 幂等，多进程重复接续也只会结算一次。
- 排队时长 / 生成时长沿用演示变量（DEMO_SIM_QUEUE_MS / DEMO_SIM_PROCESS_MS）：production 的提供方仍是演示实现，真实换装未接入。
- 数据库级兜底：generation_tasks 带三条状态机一致性 CHECK 约束（活动任务 finished_at 必须为空、终态必有 finished_at、result_svg/failure_code 与状态联动），任何写入路径都写不出「半终结」行，长任务在心跳持续时不会被错误超时回收。

### 7.5 对账与多实例

- 单进程：每 30 秒（RECONCILE_MS）调用 `reconcile_generation` 兜底；RPC 失败只记日志、下一轮重试。
- 多实例：把对账改为 pg_cron 调度（docs/supabase-schema.sql 注释已附，**暂不启用**，待数据库联调完成后再配置），进程内循环与 pg_cron 可共存（reconcile 函数幂等）。
- 结果存储：演示 SVG 目前存在 `generation_tasks.result_svg` 列；接入真实 AI 前先接内容审核（保持 fail-closed）。

### 7.6 上线前移除

`simulated: true` 标记、“演示 Credits”免责文案、模拟失败开关、注册赠送 100 点（仅开发测试）；接入真实 AI 服务商与支付后，才可宣称真实扣费。

## 8. 测试与验证

`tests/credits.test.mjs` 覆盖演示全链路：鉴权 401、冻结→结算（先结果后扣费、幂等不重复冻结）、失败释放、余额不足整体回滚、取消释放、TASK_IN_PROGRESS、对账（超时回收/保留期清理/孤儿冻结恢复/归属校验）、演示限流 429。production 路径另有三个测试文件：

- `tests/app-mode.test.mjs`：APP_MODE 解析（demo 默认/非法值/缺配置/占位符/非 URL）与路由级行为（503 CONFIG_ERROR 不回退 demo；production 无会话 200 未登录；数据库不可达 503 DB_UNAVAILABLE，与「未登录」严格区分）；
- `tests/db-storage.test.mjs`：RPC 返回文本解析、行→Task 映射、username 候选推导；存储门面在 production + 数据库不可达时读/写一律 DbUnavailableError（失败封闭证明）；
- `tests/security-boundary.test.mjs`：静态扫描——客户端文件不得导入 admin 模块、不得出现 SUPABASE_SERVICE_ROLE_KEY；admin/服务端模块不得带 'use client'。

数据库层另有：`docs/supabase-schema.sql` 第 14 节自动化结构自检（表/列/约束/RLS/策略/函数授权/默认权限逐项断言——默认权限除规则断言外，还实建探针对象验证最终生效授权，失败即整体回滚）与 `docs/supabase-integration-tests.sql`（真实 PostgreSQL 集成测试：冻结→结算、失败→释放、重复提交、成功与取消竞争、并发结算与孤儿恢复、租约/心跳边界、数据库断连、注册回填、参数校验；附录双会话竞态为待验证项，尚未执行）；执行前提与步骤见 docs/migration-checklist.md。

运行：`npm test`；另需 `npm run lint`、`npx tsc --noEmit --incremental false`、`npm run build`。

手动冒烟（`npm run setup-login` 配置账号后 `npm run dev`）：登录 → Zone 2 显示 100/0 → 提交 standard → 冻结 2 → 进度 已提交→排队中→生成中→完成 → 结果板 + “演示生成”pill → 切换人物原图 → 两种下载 → 保存作品徽章 → 流水 freeze+settle → 重新生成 → 开模拟失败开关 → 失败告警 + 余额退还 + 重试成功 → 重启 dev 余额回 100（文档化行为）→ 未登录提交走本地预览、不动 Credits → 上传图仍被拦截 → 刷新页面任务自动恢复。
