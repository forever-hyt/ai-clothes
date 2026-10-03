/* Browser-local uploads do not use the image optimization service. */
/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import Script from "next/script";

function UploadCard({ kind }: { kind: "person" | "clothing" }) {
  const person = kind === "person";
  return <article className={`upload-card ${kind}-card`}>
    <div className="card-heading"><h3><span className="card-number">{person ? "01" : "02"}</span>{person ? "人物照片" : "服装图片"}</h3><span id={`${kind}-badge`} className="upload-badge">待上传</span></div>
    <label className="dropzone" id={`${kind}-zone`} htmlFor={`${kind}-input`}>
      <input id={`${kind}-input`} type="file" accept="image/jpeg,image/png,image/webp" />
      <div className="upload-prompt"><span className="upload-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">{person ? <><circle cx="12" cy="7" r="3" /><path d="M5 21v-3a7 7 0 0 1 14 0v3" /></> : <path d="m8 3-6 4 3 5 3-2v11h8V10l3 2 3-5-6-4c0 4-8 4-8 0Z" />}</svg></span>
        <strong>{person ? "放入你的人物照片" : "选一件心仪的服装"}</strong><span>拖拽到这里，或点击选择</span><span className="choose-file">选择图片 <span aria-hidden="true">＋</span></span><small>JPG / PNG / WebP · 不超过 5MB</small>
      </div><img id={`${kind}-preview`} hidden alt={person ? "人物图片预览" : "服装图片预览"} /><span className="replace-hint">点击更换图片</span>
    </label>
    <div className="file-line"><span id={`${kind}-name`}>{person ? "清晰的正面照片，效果更好" : "建议选择背景简洁的服装图"}</span><button type="button" id={`${kind}-remove`} hidden>移除</button></div>
  </article>;
}

export default function Home() {
  return <>
    <header className="nav"><Link className="brand" href="/" aria-label="衣境 AI 首页"><span className="logo">✦</span><strong>衣境 <span>AI</span></strong></Link><nav className="nav-caption" aria-label="主导航"><a className="nav-active" href="#studio">创作工作台</a><Link href="/privacy">隐私与安全</Link></nav><div className="account"><span className="account-hint" id="account-hint">登录后开始体验</span><button id="avatar" className="avatar" aria-label="打开账户菜单" aria-expanded="false" aria-controls="account-menu"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="12" cy="8" r="3.5" /><path d="M5 21v-2a7 7 0 0 1 14 0v2" /></svg></button><div id="account-menu" className="menu" hidden><p id="account-label">欢迎来到衣境 AI</p><button id="login-entry">登录账号 <span>↗</span></button><button id="logout" hidden>退出登录</button></div></div></header>
    <main className="studio-main">
      <section className="hero"><div className="hero-copy"><span className="eyebrow"><span className="dot" /> YOUR PERSONAL STYLE STUDIO</span><h1>下一套穿搭，<br /><em>从灵感开始。</em></h1><p>一张人物照片，一件心仪的服装。<br />让每一种风格，都有尝试的可能。</p><div className="hero-chips"><span>◇ 私密图片处理</span><span>↗ 轻松预览与下载</span></div></div><div className="hero-art" aria-hidden="true"><div className="art-orbit" /><div className="art-card art-person"><span>THE MUSE</span><svg viewBox="0 0 120 150" fill="none"><circle cx="60" cy="30" r="15" /><path d="M39 55Q60 46 81 55L94 104L79 108L74 77V137H47V77L41 108L26 104Z" /></svg><small>01 / 人物照片</small></div><div className="art-card art-clothing"><span>THE LOOK</span><svg viewBox="0 0 120 150" fill="none"><path d="M40 30L14 47L27 71L39 63V126H81V63L93 71L106 47L80 30Q60 53 40 30Z" /><path d="M49 34Q60 43 71 34" /></svg><small>02 / 风格灵感</small></div><div className="art-spark">✦</div><span className="art-caption">A LITTLE CHANGE. A NEW POSSIBILITY.</span></div></section>
      <section className="studio-section" id="studio" aria-label="换装创作工作台">
        <div className="studio-toolbar"><div><span className="tiny-label">CREATE YOUR NEXT LOOK</span><h2>AI 换装工作台 <span className="demo-tag">演示版</span></h2></div><span className="toolbar-note">当前展示原图预览，真实 AI 换装尚未开放</span></div>
        <ol className="steps" aria-label="操作步骤"><li id="step-upload" className="active" aria-current="step"><span>01</span><div><strong>上传素材</strong><small>人物 + 服装</small></div></li><li id="step-process"><span>02</span><div><strong>运行演示</strong><small>登录并确认处理</small></div></li><li id="step-result"><span>03</span><div><strong>查看与下载</strong><small>保存你的预览</small></div></li></ol>
        <div className="studio-grid">
          <section className="workspace" aria-labelledby="upload-title"><div className="workspace-head"><div><span className="tiny-label">YOUR MATERIALS</span><h2 id="upload-title">准备你的穿搭素材</h2></div><span className="material-count" id="material-count">0 / 2 已就绪</span></div><div className="uploads"><UploadCard kind="person" /><UploadCard kind="clothing" /></div>
            <div className="action"><label className="consent"><input id="privacy-consent" type="checkbox" /><span>我同意本次图片处理，已阅读 <Link href="/privacy">隐私说明</Link> 与 <Link href="/terms">服务条款</Link></span></label><button id="generate" className="primary" disabled><span aria-hidden="true">✦</span><span>开始演示预览</span><span aria-hidden="true">→</span></button><p id="status" role="status" aria-live="polite">先上传两张图片，再确认图片处理说明</p></div>
          </section>
          <section className="results" aria-labelledby="result-title"><div className="result-heading"><div><span className="tiny-label">YOUR PREVIEW</span><h2 id="result-title">作品预览</h2></div><span id="result-tag">等待预览</span></div><div id="result-empty" className="empty"><div className="result-frame"><span>✧</span><i /><i /><i /><i /></div><span className="empty-eyebrow">A NEW LOOK AWAITS</span><h3>留一个位置，给新的灵感</h3><p>上传你的素材，完成演示后<br />预览会出现在这里。</p><span className="preview-label">演示结果为人物原图</span></div><div id="result-output" hidden><div className="result-note" id="result-note" /><img id="result-image" alt="演示预览" /><a id="download-result" download="try-on.webp">下载预览图片 <span aria-hidden="true">↓</span></a></div><p className="result-footnote">仅你在当前页面查看，私人照片不公开展示</p></section>
        </div>
      </section>
      <aside className="privacy-bar" aria-label="图片隐私管理"><div className="privacy-copy"><span className="privacy-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z" /><path d="m8 12 3 3 5-6" /></svg></span><div><strong>你的照片，由你掌控</strong><p>不持久保存，不发送给第三方。页面图片每 30 分钟自动清除。</p></div></div><button id="clear-images" type="button">清除全部图片 <span aria-hidden="true">↗</span></button></aside>
    </main>
    <footer><span><strong>衣境 AI</strong><span className="footer-dot">/</span>给风格更多可能</span><div><Link href="/privacy">隐私说明</Link><Link href="/terms">服务条款</Link><span>© 2026 衣境 AI</span></div></footer>
    <dialog id="login-dialog" aria-labelledby="login-title"><form id="login-form"><button type="button" id="close-dialog" className="close" aria-label="关闭登录窗口">×</button><span className="logo">✦</span><h2 id="login-title">欢迎回到衣境</h2><p className="dialog-intro">登录后，继续你的穿搭灵感。<br />图片预览无需登录，提交处理需要授权账号。</p><label htmlFor="username">用户名</label><input id="username" name="username" autoComplete="username" maxLength={100} placeholder="输入你的用户名" required /><label htmlFor="password">密码</label><input id="password" name="password" type="password" autoComplete="current-password" maxLength={200} placeholder="输入你的密码" required /><p id="login-error" role="alert" /><button className="primary" id="login-submit">登录并继续 <span aria-hidden="true">→</span></button><p className="register-note">当前仅向授权账号开放，暂不支持注册</p></form></dialog>
    <Script src="/app.js" strategy="afterInteractive" />
  </>;
}
