import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "衣搭灵感 · AI 穿搭与虚拟试衣",
  applicationName: "衣搭灵感",
  appleWebApp: {
    title: "衣搭灵感",
  },
  description: "衣搭灵感，探索服装搭配与虚拟试衣。上传人物照片和服装图片，私密预览与下载。当前为演示版，提交处理需登录。",
  openGraph: {
    title: "衣搭灵感 · AI 穿搭与虚拟试衣",
    description: "从一件心仪的服装开始，探索你的下一套穿搭。当前为演示版。",
    siteName: "衣搭灵感",
    locale: "zh_CN",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "衣搭灵感 · AI 穿搭与虚拟试衣",
    description: "探索服装搭配与虚拟试衣灵感。当前为演示版。",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
