// ⑦ の事前計算を src/ へ写す。**ビルド時に外へ取りに行かない**(N-02)。
import { readFileSync, writeFileSync, statSync } from "node:fs";
const src = JSON.parse(readFileSync("data/compare/works.json", "utf8"));
const r4 = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 10000) / 10000 : v);
writeFileSync(
  "src/data/compare.json",
  JSON.stringify({
    ...src,
    works: src.works.map((w) => ({ ...w, diagonalShare: r4(w.diagonalShare), diagonalShareAll: r4(w.diagonalShareAll), centroidX: r4(w.centroidX), centroidY: r4(w.centroidY), aspect: r4(w.aspect) })),
  }),
);
console.log(`写した: src/data/compare.json (${(statSync("src/data/compare.json").size / 1e3).toFixed(0)} KB)`);
