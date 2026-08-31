// F-01 直線検出器(Hough 変換)。客観層。
//
// 座標系は画像中心原点、x cosθ + y sinθ = ρ、θ ∈ [0, π)。
// **(θ, ρ) と (θ+π, −ρ) は同じ直線である。**比較は lineDistance で畳んでから行う。
//
// 真値を参照しない(G-03 / T-007)。しきい値は引数であり、既定値は DEFAULT_DETECT
// 一箇所にだけ置く —— ① のスライダーはここを動かす。

import { canny, DEFAULT_CANNY, type CannyOptions } from "./canny";
import type { Line, RasterImage } from "./image";

export type AccumulateCtx = {
  cx: number;
  cy: number;
  thetaSteps: number;
  rhoSteps: number;
  /** ρ 1 px あたりのビン数 */
  rhoScale: number;
  cosT: Float64Array;
  sinT: Float64Array;
};

export type AccumulateFn = (acc: Int32Array, ctx: AccumulateCtx, x: number, y: number) => void;

export const defaultAccumulate: AccumulateFn = (acc, ctx, x, y) => {
  // 画素中心を使う(image.ts の toCenter と同じ規約)
  const dx = x + 0.5 - ctx.cx;
  const dy = y + 0.5 - ctx.cy;
  const half = ctx.rhoSteps >> 1;
  for (let t = 0; t < ctx.thetaSteps; t++) {
    const rho = dx * ctx.cosT[t] + dy * ctx.sinT[t];
    const r = Math.round(rho * ctx.rhoScale) + half;
    if (r >= 0 && r < ctx.rhoSteps) acc[t * ctx.rhoSteps + r]++;
  }
};

export type DetectOptions = {
  canny: CannyOptions;
  /** θ のビン数。180 なら 1° 刻み */
  thetaSteps: number;
  /** ρ 1 px あたりのビン数 */
  rhoScale: number;
  /** 最大票数に対する比。① のしきい値スライダーはここを動かす */
  voteRatio: number;
  /** 非極大抑制の窓(θ ビン / ρ ビン) */
  nmsTheta: number;
  nmsRho: number;
  /** 返す直線の上限 */
  maxLines: number;
  /** 差し替え可能な投票関数。陽性対照(壊した版)を差し込む口(T-004) */
  accumulate?: AccumulateFn;
  /**
   * 角度表を外から与える。**二実装照合で使う**(G-06a)。
   *
   * cos/sin は Rust と V8 で最終 ULP が食い違う(実測 2026-08-31: 44/2000・50/2000)。
   * 自前で計算したままだと「アルゴリズムの差」と「libm の差」が混ざるので、
   * 照合のときだけ同じ表を両実装へ渡す。実運用ではこの口を使わない。
   */
  angleTable?: { cos: Float64Array; sin: Float64Array };
};

// 既定値は実測(2026-08-31)で決めた。
//
// **分解能**: thetaSteps=180(1° ビン)/ rhoScale=1(1 px ビン)。900 ケース掃引で
// 最悪 Δθ=0.137° / Δρ=0.537 px。360/2 に上げると Δρ=0.801 px と **悪くなる** ——
// ビンを細かくすると票が分散し、±1 ビンの重心補間が拾う裾が痩せるためである。
// 「分解能を上げれば精度が上がる」は、重心補間を挟むと成り立たない。
//
// **voteRatio**: 0.25。5 本同時の検査(T-003)で、0.5 では弦の短い線が下限を割って
// 5 本中 3 本しか復元できなかった。0.25 で 5 本すべてを復元し、誤検出は 0 本。
// 0.1 まで下げると 7 本になり誤検出が出る。① のしきい値スライダーはここを動かす ——
// **「その絵の構図線」が分析者の選択の関数であること**を、この値が体現している。
export const DEFAULT_DETECT: DetectOptions = {
  canny: DEFAULT_CANNY,
  thetaSteps: 180,
  rhoScale: 1,
  voteRatio: 0.25,
  nmsTheta: 3,
  nmsRho: 4,
  maxLines: 32,
};

export type HoughResult = {
  acc: Int32Array;
  ctx: AccumulateCtx;
};

export function houghTransform(
  edges: Uint8Array,
  width: number,
  height: number,
  opts: DetectOptions,
): HoughResult {
  const cx = width / 2;
  const cy = height / 2;
  const R = Math.hypot(cx, cy);
  const rhoSteps = 2 * Math.ceil(R * opts.rhoScale) + 1;
  let cosT: Float64Array;
  let sinT: Float64Array;
  if (opts.angleTable) {
    if (opts.angleTable.cos.length !== opts.thetaSteps || opts.angleTable.sin.length !== opts.thetaSteps) {
      throw new Error(
        `角度表の長さ(${opts.angleTable.cos.length}/${opts.angleTable.sin.length})が thetaSteps=${opts.thetaSteps} と合わない`,
      );
    }
    cosT = opts.angleTable.cos;
    sinT = opts.angleTable.sin;
  } else {
    cosT = new Float64Array(opts.thetaSteps);
    sinT = new Float64Array(opts.thetaSteps);
    for (let t = 0; t < opts.thetaSteps; t++) {
      const th = (t * Math.PI) / opts.thetaSteps;
      cosT[t] = Math.cos(th);
      sinT[t] = Math.sin(th);
    }
  }
  const ctx: AccumulateCtx = {
    cx,
    cy,
    thetaSteps: opts.thetaSteps,
    rhoSteps,
    rhoScale: opts.rhoScale,
    cosT,
    sinT,
  };
  const acc = new Int32Array(opts.thetaSteps * rhoSteps);
  const accumulate = opts.accumulate ?? defaultAccumulate;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (edges[y * width + x]) accumulate(acc, ctx, x, y);
    }
  }
  return { acc, ctx };
}

/**
 * 極大抽出。ビンの重心で補間して量子化誤差を落とす。
 * θ は端で巻き込む —— t = 0 の隣は t = thetaSteps − 1 で、そこでは ρ の符号が反転する。
 */
export function extractPeaks(res: HoughResult, opts: DetectOptions): Line[] {
  const { acc, ctx } = res;
  const { thetaSteps, rhoSteps } = ctx;
  let max = 0;
  for (let i = 0; i < acc.length; i++) if (acc[i] > max) max = acc[i];
  if (max === 0) return [];
  const minVotes = Math.max(1, max * opts.voteRatio);

  const cand: { t: number; r: number; v: number }[] = [];
  for (let t = 0; t < thetaSteps; t++) {
    for (let r = 1; r < rhoSteps - 1; r++) {
      const v = acc[t * rhoSteps + r];
      if (v < minVotes) continue;
      // 局所最大か(θ は巻き込み、ρ は境界を除いてある)
      let isMax = true;
      for (let dt = -1; dt <= 1 && isMax; dt++) {
        for (let dr = -1; dr <= 1; dr++) {
          if (dt === 0 && dr === 0) continue;
          const [tt, rr] = wrap(t + dt, r + dr, thetaSteps, rhoSteps);
          if (tt < 0) continue;
          if (acc[tt * rhoSteps + rr] > v) {
            isMax = false;
            break;
          }
        }
      }
      if (isMax) cand.push({ t, r, v });
    }
  }
  cand.sort((a, b) => b.v - a.v || a.t - b.t || a.r - b.r);

  const kept: { t: number; r: number; v: number }[] = [];
  for (const c of cand) {
    if (kept.length >= opts.maxLines) break;
    const near = kept.some((k) => {
      const dt = circularBinDistance(k.t, c.t, thetaSteps);
      // θ が巻き込んだ組では ρ の符号が反転している
      const flipped = Math.abs(k.t - c.t) > thetaSteps / 2;
      const kr = flipped ? rhoSteps - 1 - k.r : k.r;
      return dt <= opts.nmsTheta && Math.abs(kr - c.r) <= opts.nmsRho;
    });
    if (!near) kept.push(c);
  }

  return kept.map((k) => refine(acc, ctx, k.t, k.r));
}

function wrap(t: number, r: number, thetaSteps: number, rhoSteps: number): [number, number] {
  if (r < 0 || r >= rhoSteps) return [-1, -1];
  if (t >= 0 && t < thetaSteps) return [t, r];
  // θ が範囲外 —— 反対端へ巻き込み、ρ の符号を反転する
  const tt = ((t % thetaSteps) + thetaSteps) % thetaSteps;
  const rr = rhoSteps - 1 - r;
  return [tt, rr];
}

function circularBinDistance(a: number, b: number, n: number): number {
  const d = Math.abs(a - b);
  return Math.min(d, n - d);
}

/** ±1 ビンの票で重心を取り、ビンの中心からのずれを補う */
function refine(acc: Int32Array, ctx: AccumulateCtx, t: number, r: number): Line {
  const { thetaSteps, rhoSteps, rhoScale } = ctx;
  let wt = 0;
  let wr = 0;
  let sum = 0;
  for (let dt = -1; dt <= 1; dt++) {
    for (let dr = -1; dr <= 1; dr++) {
      const [tt, rr] = wrap(t + dt, r + dr, thetaSteps, rhoSteps);
      if (tt < 0) continue;
      const v = acc[tt * rhoSteps + rr];
      // 巻き込んだ側は ρ 軸が反転しているので、重心の寄与も反転させる
      const flipped = t + dt < 0 || t + dt >= thetaSteps;
      wt += v * dt;
      wr += v * (flipped ? -dr : dr);
      sum += v;
    }
  }
  const ft = sum > 0 ? t + wt / sum : t;
  const fr = sum > 0 ? r + wr / sum : r;
  const theta = (ft * Math.PI) / thetaSteps;
  const rho = (fr - (rhoSteps >> 1)) / rhoScale;
  return normalizeLine({ theta, rho });
}

/** θ を [0, π) に畳む。畳むとき ρ の符号が反転する */
export function normalizeLine(l: Line): Line {
  let theta = l.theta;
  let rho = l.rho;
  const PI = Math.PI;
  while (theta < 0) {
    theta += PI;
    rho = -rho;
  }
  while (theta >= PI) {
    theta -= PI;
    rho = -rho;
  }
  return { theta, rho };
}

export type LineDistance = {
  dThetaDeg: number;
  dRho: number;
  /** θ を px に換算して足した合成距離。最近傍を選ぶためだけに使う */
  combined: number;
};

/** (θ+π, −ρ) の同値を畳んでから 2 直線の隔たりを測る */
export function lineDistance(a: Line, b: Line, radius: number): LineDistance {
  const A = normalizeLine(a);
  const B = normalizeLine(b);
  const raw = Math.abs(A.theta - B.theta);
  const wrapped = Math.PI - raw;
  let dTheta: number;
  let dRho: number;
  if (raw <= wrapped) {
    dTheta = raw;
    dRho = Math.abs(A.rho - B.rho);
  } else {
    dTheta = wrapped;
    dRho = Math.abs(A.rho + B.rho);
  }
  const dThetaDeg = (dTheta * 180) / Math.PI;
  return { dThetaDeg, dRho, combined: dRho + dTheta * radius };
}

export function detectLines(img: RasterImage, opts: DetectOptions = DEFAULT_DETECT): Line[] {
  const edges = canny(img, opts.canny);
  const res = houghTransform(edges, img.width, img.height, opts);
  return extractPeaks(res, opts);
}
