// 検出エッジを当てはまりスコアの特徴点に直す。
//
// 座標は中心原点(image.ts の toCenter 規約)。
// **間引きは決定論**でなければならない —— 帰無分布は点集合の関数なので、
// 点が変われば z が変わる(G-04)。
//
// 真値を参照しない(G-03)。

import { toCenter, type Point } from "./image";

/** 帰無分布を回すときの既定の点数。SPEC §5.1 の枚数と合わせて計算量が決まる */
export const DEFAULT_MAX_POINTS = 2000;

/**
 * エッジマスクから特徴点を作る。
 * `maxPoints` を超えたら **等間隔で間引く** —— 乱数を使うと決定論が保てるかが
 * シード管理に依存してしまうし、等間隔なら画面の一部に偏らない。
 */
export function edgePoints(
  edges: Uint8Array,
  width: number,
  height: number,
  maxPoints: number = DEFAULT_MAX_POINTS,
): Point[] {
  const all: Point[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (edges[y * width + x]) all.push({ x: toCenter(x, width), y: toCenter(y, height) });
    }
  }
  if (all.length <= maxPoints) return all;
  const step = all.length / maxPoints;
  const out: Point[] = [];
  for (let i = 0; i < maxPoints; i++) out.push(all[Math.floor(i * step)]);
  return out;
}
