import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./member/member-theme.css";

export const metadata: Metadata = {
  title: "妙妙剪辑团积分中心",
  description: "妙妙剪辑团成员积分、视频和礼品兑换中心",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#6848d9",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
