// F-09 ⑤ノタン —— 絵を明暗の面の構成として見る。客観層(SPEC §7)。
//
// 「notan(濃淡)」は日本の画論の語で、20 世紀初頭に Arthur Wesley Dow らを介して
// 西洋のデザイン教育へ輸入された。**この画面自体が受容史の話題になる**ので、
// 語の来歴は `/about`(F-16)に書く。ここでは計算だけを持つ。
//
// 真値を参照しない(G-03)。輝度変換は canny.ts の LUMA を共有する(N-07: 一箇所に持つ)。

import { LUMA } from "./canny";
import { toCenter, type Point, type RasterImage } from "./image";

/** 段数は 2 と 3 だけ。4 段以上は「明暗の面」ではなく単なる減色になる */
export const NOTAN_LEVELS = [2, 3] as const;
export type NotanLevel = (typeof NOTAN_LEVELS)[number];

function luma(img: RasterImage, i: number): number {
  return LUMA.r * img.data[i] + LUMA.g * img.data[i + 1] + LUMA.b * img.data[i + 2];
}

/**
 * 明度で重み付けした画面の重心。座標は **画像中心原点**。
 * 画素の位置はその中心(x, y)を使う。
 *
 * 総明度が 0 のときは `null` —— 分母 0 の縮退を黙って通さない(HC-097)。
 * 「真っ黒な絵の重心は画面中心」という嘘をつかないためである。
 */
export function luminanceCentroid(img: RasterImage): Point | null {
  let sw = 0;
  let sx = 0;
  let sy = 0;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const w = luma(img, (y * img.width + x) * 4);
      if (w === 0) continue;
      sw += w;
      sx += w * x;
      sy += w * y;
    }
  }
  if (sw === 0) return null;
  return { x: toCenter(sx / sw, img.width), y: toCenter(sy / sw, img.height) };
}

/**
 * 明暗の面へ落とす。`threshold` は 0–1(輝度 0–255 に対する比)。
 *
 * - 2 値: threshold より暗ければ 0、それ以外 255
 * - 3 値: threshold を中心に上下へ等間隔で 2 本のしきい値を置き、0 / 128 / 255
 *
 * しきい値は **分析者が選ぶ**。既定値は宣言値にすぎず、動かせば面の構成は変わる ——
 * ① のしきい値スライダーと同じ性格を持つ(SPEC §7)。
 */
export function posterize(img: RasterImage, levels: NotanLevel, threshold: number): RasterImage {
  const out: RasterImage = {
    data: new Uint8ClampedArray(img.data.length),
    width: img.width,
    height: img.height,
  };
  const t = Math.min(1, Math.max(0, threshold)) * 255;
  const spread = 255 / 6; // 3 値のときの上下しきい値の間隔(既定・宣言値)
  for (let p = 0; p < img.width * img.height; p++) {
    const i = p * 4;
    const v = luma(img, i);
    let q: number;
    if (levels === 2) {
      q = v < t ? 0 : 255;
    } else {
      q = v < t - spread ? 0 : v < t + spread ? 128 : 255;
    }
    out.data[i] = q;
    out.data[i + 1] = q;
    out.data[i + 2] = q;
    out.data[i + 3] = 255;
  }
  return out;
}

/**
 * 左右反転。画家が構図を確かめるのに使ってきた古典的な手法で、
 * ⑤ では原画と並置する(F-09)。
 */
export function mirrorHorizontal(img: RasterImage): RasterImage {
  const out: RasterImage = {
    data: new Uint8ClampedArray(img.data.length),
    width: img.width,
    height: img.height,
  };
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const src = (y * img.width + (img.width - 1 - x)) * 4;
      const dst = (y * img.width + x) * 4;
      out.data[dst] = img.data[src];
      out.data[dst + 1] = img.data[src + 1];
      out.data[dst + 2] = img.data[src + 2];
      out.data[dst + 3] = img.data[src + 3];
    }
  }
  return out;
}

/** 明暗の面の面積比。⑤ の表に出す */
export function toneAreas(img: RasterImage, levels: NotanLevel, threshold: number): number[] {
  const q = posterize(img, levels, threshold);
  const counts = new Map<number, number>();
  for (let p = 0; p < q.width * q.height; p++) {
    const v = q.data[p * 4];
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  const total = q.width * q.height;
  return [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([, n]) => n / total);
}
