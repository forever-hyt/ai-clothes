# 衣境 AI · 模型服装替换

原 my-saas 项目已迁入新版米白与绿色换装工作台。保留 Next.js / Node.js 架构，主页公开访问。

## 在 VS Code 中运行

打开 my-saas 文件夹，在终端执行：

```powershell
npm install
npm run dev
```

访问 http://localhost:3000 。当前旧项目的开发服务会自动加载修改。

人物与服装图片支持 JPG、PNG、WebP，每张不超过 5MB，可拖拽上传、预览、移除。结果仍为演示人物原图，不是真实 AI 换装。点击右上角头像可登录：测试账号 admin，密码 Admin123!。注册尚未开放，未登录可以完整体验主页。

## 代码位置

- app/page.tsx：新版主页与登录弹窗。
- app/globals.css：桌面与手机布局。
- public/app.js：上传、预览、生成与账号交互。
- app/api/[...segments]/route.ts：账户状态、登录、退出、AI 演示接口。
- app/layout.tsx：网站标题与元信息。

接口：GET /api/auth/me、POST /api/auth/login、POST /api/auth/logout、POST /api/try-on。AI 请求 JSON 为 personImage 与 clothingImage 图片 Data URL；真实模型接入位置在 route.ts 的演示返回处。

可以在 .env.local 配置 LOGIN_USERNAME、LOGIN_PASSWORD、COOKIE_SECURE。本地 HTTP 不启用 Secure Cookie；HTTPS 部署启用。会话保存在单进程内存中，有效两小时，重启后失效；图片不保存到服务器。

## 部署

执行 npm run build，然后 npm start。通过系统服务保持 Node.js 运行，配置域名与 HTTPS 反向代理。正式开放前添加接口限流，多实例使用共享会话存储。AI 密钥仅放服务端环境变量。
