export default function Home() {
  return (
    <div className="min-h-screen bg-white font-sans text-zinc-900 antialiased">
      {/* ── 顶部导航 ── */}
      <header className="sticky top-0 z-50 border-b border-zinc-100 bg-white/80 backdrop-blur-md">
        <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <a href="#" className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600 to-fuchsia-500 text-sm font-bold text-white shadow-lg shadow-violet-500/25">
              AI
            </span>
            <span className="text-lg font-bold tracking-tight">
              AI衣橱 · 换装工坊
            </span>
          </a>
          <div className="hidden items-center gap-8 text-sm font-medium text-zinc-600 md:flex">
            <a href="#features" className="transition hover:text-zinc-900">
              核心功能
            </a>
            <a href="#steps" className="transition hover:text-zinc-900">
              使用流程
            </a>
            <a href="#pricing" className="transition hover:text-zinc-900">
              套餐价格
            </a>
          </div>
          <a
            href="#cta"
            className="rounded-full bg-zinc-900 px-5 py-2 text-sm font-medium text-white transition hover:bg-zinc-700"
          >
            免费体验
          </a>
        </nav>
      </header>

      <main>
        {/* ── 首屏 ── */}
        <section className="relative overflow-hidden bg-gradient-to-b from-violet-50 via-white to-white">
          <div className="pointer-events-none absolute -top-32 left-1/2 h-96 w-[36rem] -translate-x-1/2 rounded-full bg-gradient-to-r from-violet-200/60 via-fuchsia-200/50 to-pink-200/60 blur-3xl" />
          <div className="relative mx-auto max-w-6xl px-6 pt-20 pb-24 text-center sm:pt-28">
            <span className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-white px-4 py-1.5 text-sm font-medium text-violet-700 shadow-sm">
              ✨ 全新 AI 换装体验 · 无需实拍模特
            </span>
            <h1 className="mx-auto mt-8 max-w-3xl text-4xl font-bold leading-tight tracking-tight sm:text-6xl">
              上传一件衣服，
              <br />
              <span className="bg-gradient-to-r from-violet-600 via-fuchsia-500 to-pink-500 bg-clip-text text-transparent">
                AI 模特立刻穿上它
              </span>
            </h1>
            <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-zinc-600">
              无需拍摄、无需模特、无需修图。上传服装照片，AI
              自动生成专业模特试穿效果图，电商上新快人一步。
            </p>
            <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <a
                href="#cta"
                className="rounded-full bg-gradient-to-r from-violet-600 to-fuchsia-500 px-8 py-3.5 text-base font-semibold text-white shadow-lg shadow-violet-500/30 transition hover:shadow-xl hover:shadow-violet-500/40 hover:brightness-110"
              >
                立即免费体验
              </a>
              <a
                href="#features"
                className="rounded-full border border-zinc-200 bg-white px-8 py-3.5 text-base font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
              >
                了解核心功能 ↓
              </a>
            </div>

            {/* 效果演示卡片 */}
            <div className="mx-auto mt-16 flex max-w-3xl flex-col items-center justify-center gap-4 sm:flex-row">
              <div className="w-full rounded-3xl border border-zinc-100 bg-white p-6 shadow-xl shadow-violet-100/60 sm:w-64">
                <div className="flex h-40 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-50 to-orange-100 text-6xl">
                  👗
                </div>
                <p className="mt-4 text-sm font-semibold text-zinc-700">
                  上传服装照片
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  平铺图 / 挂拍图均可
                </p>
              </div>
              <div className="animate-float flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-600 to-fuchsia-500 text-xl text-white shadow-lg shadow-violet-500/40">
                ✨
              </div>
              <div className="w-full rounded-3xl border border-zinc-100 bg-white p-6 shadow-xl shadow-violet-100/60 sm:w-64">
                <div className="flex h-40 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-50 to-fuchsia-100 text-6xl">
                  🧍‍♀️
                </div>
                <p className="mt-4 text-sm font-semibold text-zinc-700">
                  AI 生成模特效果
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  约 30 秒出高清图
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ── 数据条 ── */}
        <section className="border-y border-zinc-100 bg-zinc-50/60">
          <div className="mx-auto grid max-w-6xl grid-cols-2 gap-8 px-6 py-10 text-center sm:grid-cols-4">
            {[
              ["10万+", "已生成效果图"],
              ["30秒", "平均出图时间"],
              ["98%", "用户满意度"],
              ["500+", "电商商家在用"],
            ].map(([num, label]) => (
              <div key={label}>
                <p className="bg-gradient-to-r from-violet-600 to-fuchsia-500 bg-clip-text text-3xl font-bold text-transparent">
                  {num}
                </p>
                <p className="mt-1 text-sm text-zinc-500">{label}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── 核心功能 ── */}
        <section id="features" className="mx-auto max-w-6xl px-6 py-20">
          <h2 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">
            核心功能
          </h2>
          <p className="mx-auto mt-4 max-w-md text-center text-zinc-600">
            从一张服装照片到专业电商效果图，只需几分钟
          </p>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {[
              [
                "🎯",
                "智能服装识别",
                "AI 精准识别版型、颜色与材质，自动贴合模特身材，细节不失真。",
              ],
              [
                "👩‍🦰",
                "海量模特库",
                "多肤色、多姿势、多场景的专业虚拟模特，任你随心挑选。",
              ],
              [
                "⚡",
                "极速出图",
                "最快 30 秒生成高清效果图，支持批量处理，上新不排队。",
              ],
              [
                "🛍️",
                "电商尺寸适配",
                "输出 1:1、3:4 等多种电商常用尺寸，下载即可直接上架。",
              ],
            ].map(([icon, title, desc]) => (
              <div
                key={title}
                className="rounded-3xl border border-zinc-100 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-lg hover:shadow-violet-100/60"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-50 text-2xl">
                  {icon}
                </div>
                <h3 className="mt-4 text-lg font-semibold">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-zinc-600">
                  {desc}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ── 使用流程 ── */}
        <section id="steps" className="bg-zinc-50/60 py-20">
          <div className="mx-auto max-w-6xl px-6">
            <h2 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">
              三步完成换装
            </h2>
            <div className="mt-12 grid gap-6 md:grid-cols-3">
              {[
                [
                  "1",
                  "上传服装照片",
                  "上传平铺图或挂拍图，AI 自动识别服装主体。",
                ],
                [
                  "2",
                  "选择模特场景",
                  "从模特库挑选模特、姿势与背景场景。",
                ],
                [
                  "3",
                  "一键生成下载",
                  "AI 生成高清试穿效果图，直接下载使用。",
                ],
              ].map(([no, title, desc]) => (
                <div
                  key={no}
                  className="rounded-3xl border border-zinc-100 bg-white p-8 shadow-sm"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-violet-600 to-fuchsia-500 text-lg font-bold text-white">
                    {no}
                  </span>
                  <h3 className="mt-4 text-lg font-semibold">{title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-zinc-600">
                    {desc}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── 套餐价格 ── */}
        <section id="pricing" className="mx-auto max-w-6xl px-6 py-20">
          <h2 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">
            简单透明的价格
          </h2>
          <p className="mx-auto mt-4 max-w-md text-center text-zinc-600">
            先免费试用，满意后再升级
          </p>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {[
              {
                name: "免费版",
                price: "¥0",
                unit: "",
                desc: "适合初次体验",
                features: [
                  "每天 3 次生成",
                  "标清效果图",
                  "基础模特库",
                  "图片带水印",
                ],
                highlight: false,
                btn: "免费开始",
              },
              {
                name: "专业版",
                price: "¥49",
                unit: "/月",
                desc: "适合电商店主日常上新",
                features: [
                  "无限次生成",
                  "高清无水印",
                  "全部模特与场景",
                  "批量处理",
                  "优先出图通道",
                ],
                highlight: true,
                btn: "立即升级",
              },
              {
                name: "企业版",
                price: "定制",
                unit: "",
                desc: "适合品牌与团队",
                features: [
                  "API 接口接入",
                  "专属服务器",
                  "私有模特库",
                  "7×24 技术支持",
                ],
                highlight: false,
                btn: "联系销售",
              },
            ].map((plan) => (
              <div
                key={plan.name}
                className={
                  plan.highlight
                    ? "relative rounded-3xl bg-gradient-to-b from-violet-600 to-fuchsia-500 p-8 text-white shadow-xl shadow-violet-500/30"
                    : "rounded-3xl border border-zinc-100 bg-white p-8 shadow-sm"
                }
              >
                {plan.highlight && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-zinc-900 px-4 py-1 text-xs font-semibold text-white">
                    最受欢迎
                  </span>
                )}
                <h3 className="text-lg font-semibold">{plan.name}</h3>
                <p
                  className={
                    plan.highlight
                      ? "mt-1 text-sm text-white/80"
                      : "mt-1 text-sm text-zinc-500"
                  }
                >
                  {plan.desc}
                </p>
                <p className="mt-4">
                  <span className="text-4xl font-bold">{plan.price}</span>
                  <span
                    className={
                      plan.highlight
                        ? "text-sm text-white/80"
                        : "text-sm text-zinc-500"
                    }
                  >
                    {plan.unit}
                  </span>
                </p>
                <ul className="mt-6 space-y-3 text-sm">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-center gap-2">
                      <span
                        className={
                          plan.highlight ? "text-white" : "text-violet-600"
                        }
                      >
                        ✓
                      </span>
                      <span
                        className={
                          plan.highlight ? "text-white/90" : "text-zinc-600"
                        }
                      >
                        {f}
                      </span>
                    </li>
                  ))}
                </ul>
                <a
                  href="#cta"
                  className={
                    plan.highlight
                      ? "mt-8 block rounded-full bg-white py-3 text-center text-sm font-semibold text-violet-700 transition hover:bg-zinc-100"
                      : "mt-8 block rounded-full border border-zinc-200 py-3 text-center text-sm font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
                  }
                >
                  {plan.btn}
                </a>
              </div>
            ))}
          </div>
        </section>

        {/* ── 底部号召 ── */}
        <section id="cta" className="px-6 pb-20">
          <div className="relative mx-auto max-w-6xl overflow-hidden rounded-3xl bg-gradient-to-r from-violet-600 via-fuchsia-500 to-pink-500 px-6 py-16 text-center text-white">
            <div className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full bg-white/10 blur-2xl" />
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              准备好让新品火速上架了吗？
            </h2>
            <p className="mx-auto mt-4 max-w-md text-white/85">
              注册即送免费次数，上传第一件衣服，见证 AI 模特的魔力。
            </p>
            <a
              href="mailto:hello@aicloset.example.com"
              className="mt-8 inline-block rounded-full bg-white px-8 py-3.5 text-base font-semibold text-violet-700 shadow-lg transition hover:bg-zinc-100"
            >
              立即开始 →
            </a>
          </div>
        </section>
      </main>

      {/* ── 页脚 ── */}
      <footer className="border-t border-zinc-100 py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 text-sm text-zinc-500 sm:flex-row">
          <div className="flex items-center gap-2 font-semibold text-zinc-700">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600 to-fuchsia-500 text-xs font-bold text-white">
              AI
            </span>
            AI衣橱 · 换装工坊
          </div>
          <p>© 2026 AI衣橱 · 换装工坊 · 让每一件衣服都有模特</p>
        </div>
      </footer>
    </div>
  );
}
