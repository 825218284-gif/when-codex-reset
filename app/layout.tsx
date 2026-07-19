import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Codex 硬重置雷达",
  description: "追踪 Codex 未来 48 小时重置信号与已确认硬重置时间轴。",
  openGraph: {
    title: "Codex 硬重置雷达",
    description: "未来 48 小时重置信号与已确认硬重置时间轴。",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Codex 硬重置雷达",
    description: "未来 48 小时重置信号与已确认硬重置时间轴。",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
