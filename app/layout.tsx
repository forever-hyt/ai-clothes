import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "衣境 AI · 模型服装替换",
  description: "衣境 AI 穿搭工作台：上传人物与服装图片，私密预览与下载。当前为演示版，提交处理需登录。",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
