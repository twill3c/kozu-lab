// ④ の事前計算(第 1 段)。実作品 200 点から **特徴点** を作る。
//
// 経路: Met から original を落とす → Python(Pillow)で短辺 1024 へ縮小して復号
//       → TS で Canny → エッジ点を間引いて保存。
//
// **画像も点集合もリポジトリに入れない**(N-03 の趣旨)。配るのはスコアの JSON だけ。
// 点集合は data/points/ に置き、.gitignore で外してある。
//
// C 群(破壊版)もここで作る —— トリム / 回転 / 鏡像は画像の段で効くので、
// 点にしてからでは作れない。
//
// 実行: npx tsx scripts/build-points.ts [--limit N]

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canny } from "../src/core/canny";
import { makeGridAligned, makePinkNoise, makeRandomRects } from "../src/core/controls";
import { destroy, DESTROY_KINDS } from "../src/core/destroy";
import type { RasterImage } from "../src/core/image";
import { edgePoints } from "../src/core/points";
import { fromRaw } from "../src/core/raster";

const UA = "kozu-lab-research/0.1 (twill3c@gmail.com)";
const FRAME = "data/frames/met-ep.json";
const OUT = "data/points";
const WORK = join(tmpdir(), "kozu-images");
const SHORT = 1024; // SPEC §3.6 の正規化。§3.4 で web-large では届かないと決着済み
const MAX_POINTS = 2000;

type Member = { objectID: number; title: string; primaryImage: string };

function savePoints(name: string, pts: { x: number; y: number }[], w: number, h: number): void {
  // f32 の (x, y) 並び + 寸法。JSON より小さく、Rust から読みやすい
  const buf = Buffer.alloc(8 + pts.length * 8);
  buf.writeInt32LE(w, 0);
  buf.writeInt32LE(h, 4);
  pts.forEach((p, i) => {
    buf.writeFloatLE(p.x, 8 + i * 8);
    buf.writeFloatLE(p.y, 8 + i * 8 + 4);
  });
  writeFileSync(join(OUT, `${name}.bin`), buf);
}

function analyze(img: RasterImage, name: string): number {
  const pts = edgePoints(canny(img), img.width, img.height, MAX_POINTS);
  savePoints(name, pts, img.width, img.height);
  return pts.length;
}

function decode(jpg: string, prefix: string): RasterImage {
  execFileSync("python", ["scripts/decode_image.py", jpg, prefix, "--short", String(SHORT)], {
    encoding: "utf-8",
  });
  const meta = JSON.parse(readFileSync(`${prefix}.json`, "utf8")) as { width: number; height: number };
  return fromRaw(new Uint8Array(readFileSync(`${prefix}.bin`)), meta);
}

async function download(url: string, dest: string): Promise<boolean> {
  if (existsSync(dest)) return true;
  for (let i = 0; i < 5; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA } });
      if (r.ok) {
        writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
        return true;
      }
      if (r.status === 404) return false;
    } catch {
      /* 再試行 */
    }
    await new Promise((res) => setTimeout(res, Math.min(15000, 800 * 2 ** i)));
  }
  return false;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  mkdirSync(WORK, { recursive: true });
  const limitArg = process.argv.indexOf("--limit");
  const limit = limitArg >= 0 ? Number(process.argv[limitArg + 1]) : Infinity;

  const frame = JSON.parse(readFileSync(FRAME, "utf8")) as { members: Member[] };
  const members = frame.members.slice(0, Math.min(limit, frame.members.length));

  const manifest: Record<string, unknown>[] = [];
  let failed = 0;
  for (const [i, m] of members.entries()) {
    const key = `A-${m.objectID}`;
    if (existsSync(join(OUT, `${key}.bin`))) {
      manifest.push({ key, objectID: m.objectID, cached: true });
      continue;
    }
    const jpg = join(WORK, `${m.objectID}.jpg`);
    const ok = await download(m.primaryImage, jpg);
    if (!ok) {
      // **落としたものは黙って捨てず、なぜ落としたかを残す**
      manifest.push({ key, objectID: m.objectID, dropped: "画像が取れない" });
      failed++;
      continue;
    }
    const img = decode(jpg, join(WORK, String(m.objectID)));
    const n = analyze(img, key);
    const row: Record<string, unknown> = {
      key,
      objectID: m.objectID,
      title: m.title,
      width: img.width,
      height: img.height,
      points: n,
      destroyed: {} as Record<string, string>,
    };
    for (const k of DESTROY_KINDS) {
      const d = destroy(img, k);
      const dk = `C-${k}-${m.objectID}`;
      analyze(d, dk);
      (row.destroyed as Record<string, string>)[k] = dk;
    }
    manifest.push(row);
    if ((i + 1) % 10 === 0) console.log(`  ${i + 1}/${members.length}(取れなかった ${failed} 件)`);
  }

  // 合成対照群。**A 群と同じ枚数**にする(検定力を群ごとに揃える)
  const synth = members.length;
  for (let i = 0; i < synth; i++) {
    const o = { width: 1280, height: 1024, seed: 20260831 + i };
    analyze(makeGridAligned({ ...o, ratio: "thirds" }), `P-${i}`);
    analyze(makeRandomRects(o), `D-${i}`);
    analyze(makePinkNoise(o), `E-${i}`);
  }
  console.log(`合成対照群 ${synth} 組(P / D / E)`);

  writeFileSync(
    join(OUT, "manifest.json"),
    JSON.stringify(
      {
        builtAt: "2026-08-31",
        frame: FRAME,
        shortSide: SHORT,
        maxPoints: MAX_POINTS,
        synthSize: { width: 1280, height: 1024 },
        note:
          "画像も点集合もリポジトリに入れない(N-03)。配るのは data/scores のスコアだけ。" +
          "取れなかった作品は dropped 欄に理由を残す —— 黙って落とさない。",
        works: manifest,
      },
      null,
      1,
    ),
  );
  console.log(`点集合を書いた: ${OUT}/ —— 作品 ${members.length - failed} 件 / 取れなかった ${failed} 件`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
