// F-03 当てはまりスコア。SPEC §5。
//
// 生スコアは **格子線が多いほど必ず上がる**(アルマチュアは 12 本、三分割は 4 本)。
// 生のまま比べることは、線の本数を比べているに等しい。
// したがって、同じ本数・同じ角度分布のランダム格子の分布で z 化してから比べる。
//
// このファイルに比の定数は置かない(T-310 の準備)。格子の中身は grids.ts の仕事である。

import type { Grid } from "./grids";
import { randomGrid } from "./grids";
import type { Line, Point } from "./image";
import { createRng } from "./rng";

/** 点から格子への最短距離 */
export function distanceToGrid(p: Point, lines: Line[]): number {
  let best = Infinity;
  for (const l of lines) {
    const d = Math.abs(p.x * Math.cos(l.theta) + p.y * Math.sin(l.theta) - l.rho);
    if (d < best) best = d;
  }
  return best;
}

/** raw = 点ごとの exp(−d²/2σ²) の平均。点が無ければ 0 */
export function rawScore(points: Point[], grid: Grid, sigma: number): number {
  if (points.length === 0) return 0;
  if (grid.lines.length === 0) return 0;
  const denom = 2 * sigma * sigma;
  // cos/sin を先に畳んでおく(点数 × 線数 の内側ループから三角関数を追い出す)
  const ct = grid.lines.map((l) => Math.cos(l.theta));
  const st = grid.lines.map((l) => Math.sin(l.theta));
  const rho = grid.lines.map((l) => l.rho);
  let sum = 0;
  for (const p of points) {
    let best = Infinity;
    for (let i = 0; i < ct.length; i++) {
      const d = Math.abs(p.x * ct[i] + p.y * st[i] - rho[i]);
      if (d < best) best = d;
    }
    sum += Math.exp(-(best * best) / denom);
  }
  return sum / points.length;
}

export type NullDist = {
  mean: number;
  sd: number;
  trials: number;
  lineCount: number;
};

export type NullOptions = {
  sigma: number;
  seed: number;
  trials: number;
};

/**
 * 帰無分布。`spec` に数を渡すと角度は一様、Grid を渡すと **その格子と同じ角度分布**を保つ。
 * 画面側は Grid を渡す(SPEC §5.1 の「同じ本数・同じ角度分布」)。
 */
export function nullDistribution(
  points: Point[],
  spec: number | Grid,
  W: number,
  H: number,
  opts: NullOptions,
): NullDist {
  const lineCount = typeof spec === "number" ? spec : spec.lineCount;
  const angles = typeof spec === "number" ? undefined : spec.lines.map((l) => l.theta);
  const rng = createRng(opts.seed);
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < opts.trials; i++) {
    const v = rawScore(points, randomGrid(lineCount, W, H, rng, angles), opts.sigma);
    sum += v;
    sumSq += v * v;
  }
  const mean = sum / opts.trials;
  const variance = Math.max(0, sumSq / opts.trials - mean * mean) * (opts.trials / (opts.trials - 1));
  return { mean, sd: Math.sqrt(variance), trials: opts.trials, lineCount };
}

/**
 * z = (raw − 帰無平均) / 帰無標準偏差。
 * 帰無の散らばりが 0 のときは 0 を返す —— 分母 0 の縮退を黙って通さない(HC-097)。
 */
export function zScore(points: Point[], grid: Grid, dist: NullDist, sigma: number): number {
  if (dist.sd === 0) return 0;
  return (rawScore(points, grid, sigma) - dist.mean) / dist.sd;
}

/**
 * z の推定誤差(SPEC §5.1)。帰無を n 枚で推定したことに由来する不確かさ。
 *
 * 帰無平均の誤差が 1/√n、帰無標準偏差の相対誤差が 1/√(2n) なので、
 * z = (raw − m̂)/ŝ の不確かさは概ね √(1/n + z²/(2n)) になる。
 * **枚数を減らせば z は速く出るが粗くなる。**この取引を画面で隠さない。
 */
export function zUncertainty(z: number, trials: number): number {
  if (trials < 2) return Infinity;
  return Math.sqrt(1 / trials + (z * z) / (2 * trials));
}
