// ④ の事前計算(第 1.5 段)。**格子を TS から書き出す。**
//
// 比の定数(黄金比・三分割)は **規範層 grids.ts にだけ置く**(SPEC §4 / T-310)。
// Rust に移すと定数が二箇所になり、走査側と規範層の境界が崩れる。
// したがって Rust は格子を「与えられた線の集合」としてのみ扱う。
//
// **寸法は点集合のファイルそのものから読む。**manifest の width/height を使うと、
// (a) 破壊版のトリムで寸法が変わることを取り落とし、(b) 既にあって作り直さなかった
// 作品は寸法欄を持たないので落ちる —— 実測 2026-08-31 で 1,400 件中 209 件が
// 「対応する格子が無い」で飛んだ。派生した記録ではなく実物を見る。
//
// 実行: npx tsx scripts/build-grids.ts

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildGrid, GRID_KINDS } from "../src/core/grids";

const DIR = "data/points";
const OUT = join(DIR, "grids.json");

const sizes = new Set<string>();
let files = 0;
for (const f of readdirSync(DIR)) {
  if (!f.endsWith(".bin")) continue;
  const b = readFileSync(join(DIR, f));
  if (b.length < 8) continue;
  sizes.add(`${b.readInt32LE(0)}x${b.readInt32LE(4)}`);
  files++;
}

const out: Record<string, Record<string, { theta: number; rho: number }[]>> = {};
for (const s of sizes) {
  const [w, h] = s.split("x").map(Number);
  const g: Record<string, { theta: number; rho: number }[]> = {};
  for (const k of GRID_KINDS) g[k] = buildGrid(k, w, h).lines;
  out[s] = g;
}
writeFileSync(OUT, JSON.stringify({ kinds: GRID_KINDS, bySize: out }));
console.log(`格子を書いた: ${OUT} —— 点集合 ${files} 件 / ${sizes.size} 通りの寸法 × ${GRID_KINDS.length} 種`);
