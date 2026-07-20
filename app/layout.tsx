import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://codex-plus-update-desk.fl1587324.chatgpt.site"),
  title: "Codex 额度重置雷达",
  description: "以 Codex Resets 的公告记录为准，追踪 Codex 额度重置时间与公开模型、额度数据。",
  openGraph: {
    title: "Codex 额度重置雷达",
    description: "以 Codex Resets 的公告记录为准，追踪 Codex 额度重置时间与公开模型、额度数据。",
    type: "website",
    images: [{ url: "/og-midnight-fantasy.png", width: 1672, height: 941, alt: "Codex 额度重置雷达" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Codex 额度重置雷达",
    description: "以 Codex Resets 的公告记录为准，追踪 Codex 额度重置时间与公开模型、额度数据。",
    images: ["/og-midnight-fantasy.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
