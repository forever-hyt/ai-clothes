import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "衣境 AI · 模型服装替换",
  description: "上传人物与服装图片，探索你的下一套穿搭。无需登录即可体验；当前为演示模式。",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
