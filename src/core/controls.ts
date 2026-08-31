// ④ 帰無仮説の実験室の対照群(合成側)。SPEC §8。
//
// - `grid-aligned` —— **陽性対照 P 群。**主要素の重心を厳密に格子の交点へ置く。
//   ここが高く出なければスコアが機能していない(G-08)。落ちたら ④ ごと撤回する
// - `random-rects` —— 無作為矩形分割(D 群)
// - `pink-noise` —— **1/f ノイズ(E 群)。**ホワイトノイズは自然画像と統計が違いすぎて
//   楽勝の対照になるので使わない
//
// 真値を参照しない検出器と違い、ここは真値(格子の交点)を知っていてよい ——
// **生成器だからである。**検出器・スコア器はこのファイルを参照してはならない(G-03)。

import { createImage, type RasterImage } from "./image";
import { GOLDEN_CUTS } from "./grids";
import { createRng, randNormal, type Rng } from "./rng";

export const CONTROL_KINDS = ["grid-aligned", "random-rects", "pink-noise"] as const;
export type ControlKind = (typeof CONTROL_KINDS)[number];

export type ControlOptions = {
  width: number;
  height: number;
  seed: number;
};

function fill(img: RasterImage, x0: number, y0: number, w: number, h: number, v: number): void {
  const x1 = Math.min(img.width, Math.round(x0 + w));
  const y1 = Math.min(img.height, Math.round(y0 + h));
  for (let y = Math.max(0, Math.round(y0)); y < y1; y++) {
    for (let x = Math.max(0, Math.round(x0)); x < x1; x++) {
      const i = (y * img.width + x) * 4;
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
    }
  }
}

/**
 * **陽性対照 P 群。**矩形の重心が格子の交点にちょうど載るように置く。
 * `ratio` が `thirds` なら 1/3・2/3、`golden` なら 0.382・0.618。
 */
export function makeGridAligned(
  o: ControlOptions & { ratio: "thirds" | "golden" },
): RasterImage {
  const cuts = o.ratio === "thirds" ? [1 / 3, 2 / 3] : [...GOLDEN_CUTS];
  const img = createImage(o.width, o.height, 232);
  const rng = createRng(o.seed);
  // 交点 4 つに、大きさの違う矩形を重心が交点に来るように置く
  for (const fx of cuts) {
    for (const fy of cuts) {
      const w = o.width * (0.06 + rng() * 0.06);
      const h = o.height * (0.06 + rng() * 0.06);
      const v = 30 + Math.floor(rng() * 60);
      fill(img, o.width * fx - w / 2, o.height * fy - h / 2, w, h, v);
    }
  }
  // 格子線に沿った帯も置く(交点だけでなく線にも当たるように)
  for (const fx of cuts) fill(img, o.width * fx - 2, 0, 4, o.height, 60);
  for (const fy of cuts) fill(img, 0, o.height * fy - 2, o.width, 4, 60);
  return img;
}

/** D 群。画面を無作為に矩形分割して塗り分ける */
export function makeRandomRects(o: ControlOptions): RasterImage {
  const img = createImage(o.width, o.height, 232);
  const rng = createRng(o.seed);
  type Rect = { x: number; y: number; w: number; h: number };
  let rects: Rect[] = [{ x: 0, y: 0, w: o.width, h: o.height }];
  // 再帰的に 2 分割する。**深さは宣言値**
  for (let depth = 0; depth < 5; depth++) {
    const next: Rect[] = [];
    for (const r of rects) {
      if (r.w < 24 || r.h < 24 || rng() < 0.25) {
        next.push(r);
        continue;
      }
      const vertical = r.w >= r.h ? rng() < 0.8 : rng() < 0.2;
      const t = 0.25 + rng() * 0.5;
      if (vertical) {
        const cut = Math.round(r.w * t);
        next.push({ ...r, w: cut }, { ...r, x: r.x + cut, w: r.w - cut });
      } else {
        const cut = Math.round(r.h * t);
        next.push({ ...r, h: cut }, { ...r, y: r.y + cut, h: r.h - cut });
      }
    }
    rects = next;
  }
  for (const r of rects) fill(img, r.x, r.y, r.w, r.h, 30 + Math.floor(rng() * 200));
  return img;
}

/**
 * E 群。**1/f(ピンク)ノイズ。**
 *
 * ホワイトノイズは自然画像と統計が違いすぎて「当然差が出る」対照になり、
 * 帰無仮説の実験室としては弱い(SPEC §8)。
 *
 * FFT を使わず、**オクターブごとの値ノイズを 1/f の重みで足し合わせる**
 * (value noise の多重解像度合成)。低周波ほど振幅が大きくなる。
 */
export function makePinkNoise(o: ControlOptions): RasterImage {
  const img = createImage(o.width, o.height, 128);
  const acc = new Float64Array(o.width * o.height);
  const rng = createRng(o.seed);
  const octaves = 7;
  for (let k = 0; k < octaves; k++) {
    const cell = 1 << (octaves - k); // 128, 64, ... 2
    const amp = cell; // 1/f: 振幅は波長に比例
    const gw = Math.ceil(o.width / cell) + 2;
    const gh = Math.ceil(o.height / cell) + 2;
    const grid = new Float64Array(gw * gh);
    for (let i = 0; i < grid.length; i++) grid[i] = randNormal(rng);
    for (let y = 0; y < o.height; y++) {
      const gy = y / cell;
      const y0 = Math.floor(gy);
      const ty = smooth(gy - y0);
      for (let x = 0; x < o.width; x++) {
        const gx = x / cell;
        const x0 = Math.floor(gx);
        const tx = smooth(gx - x0);
        const a = grid[y0 * gw + x0];
        const b = grid[y0 * gw + x0 + 1];
        const c = grid[(y0 + 1) * gw + x0];
        const d = grid[(y0 + 1) * gw + x0 + 1];
        const v = lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
        acc[y * o.width + x] += v * amp;
      }
    }
  }
  let min = Infinity;
  let max = -Infinity;
  for (const v of acc) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const span = max - min || 1;
  for (let p = 0; p < acc.length; p++) {
    const v = ((acc[p] - min) / span) * 255;
    const i = p * 4;
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
  }
  return img;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 種類から画像を作る一本の口(④ の事前計算が使う) */
export function makeControl(kind: ControlKind, o: ControlOptions, rng?: Rng): RasterImage {
  void rng;
  switch (kind) {
    case "grid-aligned":
      return makeGridAligned({ ...o, ratio: "thirds" });
    case "random-rects":
      return makeRandomRects(o);
    case "pink-noise":
      return makePinkNoise(o);
  }
}
