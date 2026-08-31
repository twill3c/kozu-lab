// 事前計算の結果を src/ へ写す。**ビルド時に外へ取りに行かない**(N-02)ので、
// アプリが読むのはこの静的な JSON だけである。
//
// **そのまま写さず削る。**④ が要るのは
//   - 全作品の z(格子 9 種)と自由度の会計 —— 小さい
//   - 走査曲線は **A 群(観測)と E 群(帰無の帯)だけ** —— C/P/D の曲線は画面に出ない
// 全部載せると 3.8 MB になり、静的ページの初回読み込みとして重すぎる。
// 削った理由をここに書いておく —— 黙って減らすと、後から「なぜ無いのか」が分からなくなる。

import { readFileSync, writeFileSync, statSync } from "node:fs";

const src = JSON.parse(readFileSync("data/scores/works.json", "utf8"));
const KEEP_CURVES = new Set(["A", "E"]);
const groupOf = (k) =>
  k.startsWith("C-") ? `C-${k.split("-")[1]}` : k.split("-")[0];

const r3 = (v) => Math.round(v * 1000) / 1000;
const works = src.works.map((w) => {
  const g = groupOf(w.key);
  const out = {
    key: w.key,
    width: w.width,
    height: w.height,
    points: w.points,
    z: Object.fromEntries(Object.entries(w.z).map(([k, v]) => [k, r3(v)])),
    df: Object.fromEntries(Object.entries(w.df ?? {}).map(([k, v]) => [k, v.map(r3)])),
  };
  if (KEEP_CURVES.has(g)) {
    out.scanV = w.scanV.map(r3);
    out.scanH = w.scanH.map(r3);
  }
  return out;
});

writeFileSync(
  "src/data/scores.json",
  JSON.stringify({
    ...src,
    note:
      "走査曲線は A 群(観測)と E 群(帰無の帯)だけを残してある。C/P/D の曲線は画面に出ないので削った。" +
      "小数は 3 桁で丸めてある。元は data/scores/works.json(cargo run --release --bin score_all で作る)。",
    curvesFor: [...KEEP_CURVES],
    works,
  }),
);
console.log(
  `写した: src/data/scores.json (${(statSync("src/data/scores.json").size / 1e6).toFixed(2)} MB) —— ` +
    `元 ${(statSync("data/scores/works.json").size / 1e6).toFixed(2)} MB / 作品 ${works.length} 件`,
);
