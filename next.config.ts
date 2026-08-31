import type { NextConfig } from "next";

// 静的書き出しのみ。サーバ関数を一つも持たない(SPEC N-01)。
// 画像は再配布しない —— 閲覧者のブラウザが美術館から直接取る(N-03)。
// したがって next/image の最適化も使わない(使えばビルド時に外へ出る経路ができる)。
const nextConfig: NextConfig = {
  output: "export",
  reactStrictMode: true,
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
