// F-12 分割比 t の走査曲線、および F-13 の統計。SPEC §4。
//
// **このファイルに比の定数を置いてはならない —— 数字として書くことも含めて。**
// 三分割も黄金分割も、走査曲線の上の**ただの一点**である。
// 走査側がそれらを知っていたら、「その二つを測った」という事実が結論の形を先に決める。
// T-310 がこれを静的に検査する。比の値は規範層(grids.ts)にだけ置く。
//
// 帰無分布は **t に依存しない。**「同じ本数・同じ角度分布のランダム格子」とは
// 縦線 1 本を無作為な位置に置くことなので、μ と s は向きごとに 1 回でよい。
// これで 181 点の走査は raw を 181 回計算するだけになる。

import type { Point } from "./image";
import { createRng } from "./rng";

/** 走査の範囲と刻み(SPEC §4 の宣言値) */
export const T_MIN = 0.05;
export const T_MAX = 0.95;
export const T_STEP = 0.005;

export type ScanOptions = {
  sigma: number;
  seed: number;
  trials: number;
};

export type ScanPoint = { t: number; raw: number; z: number };
export type Scan = { vertical: ScanPoint[]; horizontal: ScanPoint[] };

/** 走査する t の列。集合として過不足がないことを T-301 が確かめる */
export function ratioGrid(): number[] {
  const out: number[] = [];
  const n = Math.round((T_MAX - T_MIN) / T_STEP) + 1;
  for (let i = 0; i < n; i++) out.push(T_MIN + i * T_STEP);
  return out;
}

/** 1 本の線に対する raw。線は (cos, sin, rho) で与える */
function rawOneLine(points: Point[], cos: number, sin: number, rho: number, sigma: number): number {
  if (points.length === 0) return 0;
  const denom = 2 * sigma * sigma;
  let sum = 0;
  for (const p of points) {
    const d = p.x * cos + p.y * sin - rho;
    sum += Math.exp(-(d * d) / denom);
  }
  return sum / points.length;
}

/**
 * 縦線 1 本(θ=0)または横線 1 本(θ=π/2)を無作為な位置に置いたときの raw の分布。
 * **t に依存しない**ので、走査の前に 1 回だけ作る。
 */
function nullForOneLine(
  points: Point[],
  vertical: boolean,
  extent: number,
  opts: ScanOptions,
): { mean: number; sd: number } {
  const rng = createRng(opts.seed);
  const cos = vertical ? 1 : 0;
  const sin = vertical ? 0 : 1;
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < opts.trials; i++) {
    // ρ は画面の範囲に一様。縦線なら [−W/2, W/2]
    const rho = (rng() - 0.5) * extent;
    const v = rawOneLine(points, cos, sin, rho, opts.sigma);
    sum += v;
    sumSq += v * v;
  }
  const mean = sum / opts.trials;
  const varr =
    Math.max(0, sumSq / opts.trials - mean * mean) * (opts.trials / (opts.trials - 1));
  return { mean, sd: Math.sqrt(varr) };
}

/**
 * 走査曲線。縦線を x = t に、横線を y = t に置いたときの z を 181 点で出す。
 *
 * t は画面比なので、中心原点の ρ は (t − 0.5) × 辺長 になる。
 * **0.5 は画面の中心であって、比の定数ではない**(T-310 の対象外)。
 */
export function scanRatios(points: Point[], width: number, height: number, opts: ScanOptions): Scan {
  const ts = ratioGrid();
  const nv = nullForOneLine(points, true, width, opts);
  const nh = nullForOneLine(points, false, height, opts);
  const mk = (vertical: boolean, n: { mean: number; sd: number }, extent: number): ScanPoint[] =>
    ts.map((t) => {
      const rho = (t - 0.5) * extent;
      const raw = rawOneLine(points, vertical ? 1 : 0, vertical ? 0 : 1, rho, opts.sigma);
      const z = n.sd === 0 ? 0 : (raw - n.mean) / n.sd;
      return { t, raw, z };
    });
  return { vertical: mk(true, nv, width), horizontal: mk(false, nh, height) };
}

/**
 * 順列帰無の帯。曲線の束から、各点の中央 `coverage` 区間を取る。
 *
 * **帯そのものを検算できる**ようにしてある —— 帰無から引いた曲線が
 * 帯を外れる割合は 1 − coverage に近くなるはずで、そうでなければ帯の作り方が誤っている(T-302)。
 */
export function permutationBand(
  curves: number[][],
  coverage: number,
): { lo: number[]; hi: number[]; n: number } {
  if (curves.length === 0) throw new Error("曲線が 1 本も無い");
  const m = curves[0].length;
  for (const c of curves) {
    if (c.length !== m) throw new Error("曲線の長さが揃っていない");
  }
  const alpha = (1 - coverage) / 2;
  const lo: number[] = [];
  const hi: number[] = [];
  for (let i = 0; i < m; i++) {
    const col = curves.map((c) => c[i]).sort((a, b) => a - b);
    lo.push(quantile(col, alpha));
    hi.push(quantile(col, 1 - alpha));
  }
  return { lo, hi, n: curves.length };
}

/** 昇順の配列から分位点(線形補間) */
export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

// --- 効果量と検定力 ---------------------------------------------------

function mean(v: number[]): number {
  return v.reduce((s, x) => s + x, 0) / v.length;
}
function variance(v: number[]): number {
  const m = mean(v);
  return v.reduce((s, x) => s + (x - m) * (x - m), 0) / (v.length - 1);
}

/** Cohen's d(併合標準偏差)。a − b の向き */
export function cohensD(a: number[], b: number[]): number {
  if (a.length < 2 || b.length < 2) throw new Error("各群 2 件以上が要る");
  const na = a.length;
  const nb = b.length;
  const sp = Math.sqrt(((na - 1) * variance(a) + (nb - 1) * variance(b)) / (na + nb - 2));
  if (sp === 0) return 0;
  return (mean(a) - mean(b)) / sp;
}

/** Cliff's δ。完全分離で ±1、同分布で 0 —— 正規性を仮定しない */
export function cliffsDelta(a: number[], b: number[]): number {
  let gt = 0;
  let lt = 0;
  for (const x of a) {
    for (const y of b) {
      if (x > y) gt++;
      else if (x < y) lt++;
    }
  }
  return (gt - lt) / (a.length * b.length);
}

/** 対応ありの t 検定。**長さが違えば例外**(黙って切り詰めない) */
export function pairedT(a: number[], b: number[]): { t: number; n: number; meanDiff: number; sd: number } {
  if (a.length !== b.length) throw new Error(`対応が取れていない: ${a.length} 件と ${b.length} 件`);
  const n = a.length;
  if (n < 2) throw new Error("2 対以上が要る");
  const d = a.map((x, i) => x - b[i]);
  const md = mean(d);
  const sd = Math.sqrt(variance(d));
  const t = sd === 0 ? (md === 0 ? 0 : Infinity * Math.sign(md)) : md / (sd / Math.sqrt(n));
  return { t, n, meanDiff: md, sd };
}

/** 標準正規の分位点(Acklam の近似)。検定力の計算に使う */
function probit(p: number): number {
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
  const pl = 0.02425;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - pl) return -probit(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/**
 * 2 標本 t 検定で効果量 d を検出力 power で検出するのに必要な 1 群あたりの数。
 * 正規近似 n = 2 (z_{1−α/2} + z_{power})² / d² を切り上げる。
 *
 * SPEC §8.1 の宣言値(d = 0.30 / α = .05 両側 / 検出力 .80 → 175)がここから出る。
 */
export function requiredNForPower(d: number, alpha: number, power: number): number {
  const za = probit(1 - alpha / 2);
  const zb = probit(power);
  return Math.ceil((2 * (za + zb) * (za + zb)) / (d * d));
}
