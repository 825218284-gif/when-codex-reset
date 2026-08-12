import type { Metadata } from "next";
import "./globals.css";
import "./theme-fixes.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://825218284-gif.github.io/when-codex-reset/"),
  title: "Codex 额度重置雷达",
  description: "以 Codex Resets 的公告记录为准，追踪 Codex 额度重置时间与公开模型、额度数据。",
  alternates: {
    canonical: "/when-codex-reset/",
  },
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    title: "Codex 额度重置雷达",
    description: "以 Codex Resets 的公告记录为准，追踪 Codex 额度重置时间与公开模型、额度数据。",
    type: "website",
    url: "/when-codex-reset/",
    siteName: "Codex 额度重置雷达",
    locale: "zh_CN",
    images: [{ url: "/when-codex-reset/og-midnight-fantasy.jpg", width: 1200, height: 675, alt: "Codex 额度重置雷达" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Codex 额度重置雷达",
    description: "以 Codex Resets 的公告记录为准，追踪 Codex 额度重置时间与公开模型、额度数据。",
    images: ["/when-codex-reset/og-midnight-fantasy.jpg"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
