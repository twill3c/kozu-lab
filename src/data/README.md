# src/data

④ が読む事前計算の結果。**画像は入っていない** —— ここにあるのは計算した数だけである(N-03)。

- `scores.json` —— `data/scores/works.json` の写し。ビルドに含める必要があるので src/ 側に置く。
  再生成は `cargo run --release --bin score_all` → `node scripts/sync-scores.mjs`
