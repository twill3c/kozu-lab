import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "構図ラボ — kozu-lab",
  description:
    "名画に構図の格子を重ねる行為そのものを測る。構図線を見つけるのではなく、いかに容易に見つかってしまうかを測る。",
};

// フリート共通のフッタ規約(koho-lens が正本)。
// MIT License ・ © ・ GitHub ・ 歩き方 ・ 設計図 ・ App Menu の 6 項目をこの並びで、
// position: fixed で常時表示する。**並びと項目数を揃えるのであって、文言は各アプリのものを残す。**
//
const FOOTER = {
  license: "https://github.com/twill3c/kozu-lab/blob/main/LICENSE",
  repository: "https://github.com/twill3c/kozu-lab",
  guide: "https://claude.ai/code/artifact/fe73e272-b41a-4135-99cb-2e641ec76f7b",
  blueprint: "https://claude.ai/code/artifact/1add0dc5-5967-431d-9f61-ede87f234521",
  appMenu: "https://app-menu-amber.vercel.app/",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>
        {children}
        {/* fleet: fixed footer */}
        <footer className="site-footer">
          <div className="site-footer__inner">
            <a href={FOOTER.license}>MIT License</a>
            <span className="site-footer__copy">© 2026 坂田哲朗</span>
            <span className="fsep">・</span><a href={FOOTER.repository}>GitHub</a>
            <span className="fsep">・</span><a href={FOOTER.guide}>構図ラボの歩き方</a>
            <span className="fsep">・</span><a href={FOOTER.blueprint}>構図ラボの設計図</a>
            <span className="fsep">・</span><a href={FOOTER.appMenu}>App Menu</a>
          </div>
        </footer>
      </body>
    </html>
  );
}
