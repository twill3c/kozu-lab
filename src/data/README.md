# src/data

④ が読む事前計算の結果。**画像は入っていない** —— ここにあるのは計算した数だけである(N-03)。

- `scores.json` —— ④ が読む。`data/scores/works.json` の写し(走査曲線は A/E 群だけに削り、3 桁に丸め)。
  再生成: `cargo run --release --bin score_all` → `node scripts/sync-scores.mjs`
- `compare.json` —— ⑦ が読む。再生成: `npx tsx scripts/build-compare.ts` → `node scripts/sync-compare.mjs`
- `sigma.json` —— `/about` の σ 依存。再生成: `cargo run --release --bin scan_sigma` → 手で写す
- `saliency.json` —— `/about` の G-目玉2 の判定。再生成: `npx tsx scripts/measure-saliency.ts` → 手で写す
