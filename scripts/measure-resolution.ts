// SPEC §3.4 に残った最後の見込みを、**実作品で**決着させる。
//
//   「web-large の短辺 419 px で Hough に足りるか」
//
// 実測 2026-08-31 の時点で分かっていたのは、web-large の短辺が 297–590 px しかなく、
// §3.6 が定めた正規化(短辺 1024)に届かないことだけだった。
// ここでは同じ作品を web-large と original(短辺 1024 へ縮小)で解析し、
// **検出直線の集合と当てはまりスコアがどれだけ違うか**を測る。
//
// 実行: npx tsx scripts/measure-resolution.ts
// 依存: Python(Pillow)で復号する。scripts/decode_image.py を呼ぶ

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canny } from "../src/core/canny";
import { buildGrid } from "../src/core/grids";
import { detectLines, lineDistance, DEFAULT_DETECT } from "../src/core/hough";
import { edgePoints } from "../src/core/points";
import { fromRaw } from "../src/core/raster";
import { nullDistribution, zScore } from "../src/core/score";

const UA = "kozu-lab-research/0.1 (twill3c@gmail.com)";
const BASE = "https://collectionapi.metmuseum.org/public/collection/v1";
const OUT = "data/measurements/resolution.json";
const WORK = join(tmpdir(), "kozu-resolution");
const SEED = 20260831;
const TRIALS = 2000;

/** 検査に使う作品。**標本枠の先頭から機械的に採る**(手で選ばない) */
const SAMPLE_SIZE = 12;

async function getJson(url: string): Promise<Record<string, unknown> | null> {
  for (let i = 0; i < 8; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA } });
      if (r.status === 200) return (await r.json()) as Record<string, unknown>;
      if (r.status === 404) return null;
    } catch {
      /* 再試行 */
    }
    await new Promise((res) => setTimeout(res, Math.min(20000, 600 * 2 ** i)));
  }
  throw new Error(`取得できない: ${url}`);
}

async function download(url: string, dest: string): Promise<void> {
  if (existsSync(dest)) return;
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`画像が取れない(${r.status}): ${url}`);
  writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
}

function decode(jpg: string, prefix: string, short?: number) {
  const args = ["scripts/decode_image.py", jpg, prefix];
  if (short) args.push("--short", String(short));
  execFileSync("python", args, { encoding: "utf-8" });
  const meta = JSON.parse(readFileSync(`${prefix}.json`, "utf8")) as {
    width: number;
    height: number;
  };
  return fromRaw(new Uint8Array(readFileSync(`${prefix}.bin`)), meta);
}

function analyze(img: ReturnType<typeof fromRaw>) {
  const lines = detectLines(img, DEFAULT_DETECT);
  const pts = edgePoints(canny(img), img.width, img.height);
  const grid = buildGrid("thirds", img.width, img.height);
  const dist = nullDistribution(pts, grid, img.width, img.height, {
    sigma: Math.min(img.width, img.height) * 0.01,
    seed: SEED,
    trials: TRIALS,
  });
  const z = zScore(pts, grid, dist, Math.min(img.width, img.height) * 0.01);
  return { lines, points: pts.length, z, short: Math.min(img.width, img.height) };
}

async function main() {
  mkdirSync(WORK, { recursive: true });
  mkdirSync("data/measurements", { recursive: true });

  const frame = JSON.parse(readFileSync("data/frames/met-ep.json", "utf8")) as {
    members: { objectID: number; title: string; primaryImage: string; primaryImageSmall: string }[];
  };
  const picked = frame.members.slice(0, SAMPLE_SIZE);
  console.log(`標本枠の先頭 ${picked.length} 件で測る`);

  const rows: Record<string, unknown>[] = [];
  for (const m of picked) {
    const meta = (await getJson(`${BASE}/objects/${m.objectID}`)) ?? {};
    const small = (meta.primaryImageSmall as string) || m.primaryImageSmall;
    const large = (meta.primaryImage as string) || m.primaryImage;
    if (!small || !large) {
      console.log(`  ${m.objectID}: 画像 URL が無い。飛ばす`);
      continue;
    }
    const sJpg = join(WORK, `${m.objectID}-small.jpg`);
    const lJpg = join(WORK, `${m.objectID}-large.jpg`);
    await download(small, sJpg);
    await download(large, lJpg);

    const a = analyze(decode(sJpg, join(WORK, `${m.objectID}-small`)));
    const b = analyze(decode(lJpg, join(WORK, `${m.objectID}-large`), 1024));

    // 直線集合の照合。角度 1° / ρ 短辺の 1 % 以内を「同じ線」とみなす
    const tol = b.short * 0.01;
    const R = Math.hypot(b.short, b.short);
    let matched = 0;
    for (const la of a.lines) {
      // web-large の座標系を original(1024)の尺度へ合わせる
      const scaled = { theta: la.theta, rho: (la.rho * b.short) / a.short };
      if (
        b.lines.some((lb) => {
          const d = lineDistance(scaled, lb, R);
          return d.dThetaDeg <= 1 && d.dRho <= tol;
        })
      ) {
        matched++;
      }
    }
    const row = {
      objectID: m.objectID,
      title: m.title,
      webLarge: { short: a.short, lines: a.lines.length, points: a.points, z: a.z },
      original1024: { short: b.short, lines: b.lines.length, points: b.points, z: b.z },
      matchedLines: matched,
      matchRate: a.lines.length ? matched / a.lines.length : null,
      deltaZ: b.z - a.z,
    };
    rows.push(row);
    console.log(
      `  ${m.objectID} 短辺 ${a.short}→${b.short} / 直線 ${a.lines.length}→${b.lines.length} ` +
        `(一致 ${matched}) / z ${a.z.toFixed(2)}→${b.z.toFixed(2)}`,
    );
  }

  const rates = rows.map((r) => r.matchRate as number).filter((v) => v !== null);
  const dz = rows.map((r) => Math.abs(r.deltaZ as number));
  const out = {
    question: "SPEC §3.4: web-large の短辺(実測 297–590 px)で Hough に足りるか",
    method:
      "標本枠の先頭 12 件について、web-large と original(短辺 1024 へ縮小)に同じ検出器を当て、" +
      "検出直線の一致率(Δθ ≤ 1°、Δρ ≤ 短辺の 1 %)と、三分割格子に対する z の差を測る。" +
      "帰無は 2,000 枚・シード 20260831。",
    measuredAt: "2026-08-31",
    n: rows.length,
    medianMatchRate: median(rates),
    medianAbsDeltaZ: median(dz),
    maxAbsDeltaZ: Math.max(...dz),
    rows,
  };
  writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log(
    `\n書いた: ${OUT}\n  直線の一致率(中央値) ${(median(rates) * 100).toFixed(1)} % / ` +
      `|Δz| 中央値 ${median(dz).toFixed(2)} / 最大 ${Math.max(...dz).toFixed(2)}`,
  );
}

function median(v: number[]): number {
  if (v.length === 0) return NaN;
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
