import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Codex 额度重置雷达",
  description: "以 Codex Resets 的公告记录为准，追踪 Codex 额度重置时间与公开模型、额度数据。",
  openGraph: {
    title: "Codex 额度重置雷达",
    description: "以 Codex Resets 的公告记录为准，追踪 Codex 额度重置时间与公开模型、额度数据。",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Codex 额度重置雷达",
    description: "以 Codex Resets 的公告记录为准，追踪 Codex 额度重置时间与公开模型、额度数据。",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
