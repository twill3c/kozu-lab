import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "構図ラボ — kozu-lab",
  description:
    "名画に構図の格子を重ねる行為そのものを測る。構図線を見つけるのではなく、いかに容易に見つかってしまうかを測る。",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
