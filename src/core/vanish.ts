// F-11 ② 消失点。客観層(SPEC §2)。
//
// 真値を参照しない(G-03)。入力は検出直線だけである。
//
// 直線 (θ, ρ) の同次表現は l = (cosθ, sinθ, −ρ)。点 v が線上にあることは l·v = 0 と書ける。
// したがって同じ方向の平行線群 {l_i} に対する消失点は、**Σ (l_i·v)² を最小にする単位ベクトル v**
// —— 3×3 対称行列 M = Σ l_i l_iᵀ の最小固有ベクトルである。
//
// **破綻を破綻として返す**(F-11)。平行投影では v の第 3 成分が 0 に近づき、
// 消失点は無限遠にある。そこを大きな有限値へ丸めたり、既定値で埋めたりしない ——
// 破綻することが情報だからである(印象派・浮世絵・キュビスムで推定は壊れる)。

import type { Line } from "./image";

export type VanishingPoint =
  | {
      kind: "finite";
      /** 中心原点の画素座標 */
      x: number;
      y: number;
      /** この消失点に整合した直線の本数 */
      support: number;
      /** 整合角の平均(度) */
      residual: number;
      /**
       * 位置の不確かさ(px、1σ の長軸)。**線束が細いほど大きくなる。**
       * 遠い消失点はほぼ平行な束の交点なので、位置は原理的に定まらない ——
       * その事実を数として画面に出す(F-11)。
       */
      uncertaintyPx: number;
    }
  | {
      kind: "infinite";
      /** 線束の向き(度、[0,180))。方向は捨てない */
      dirDeg: number;
      support: number;
      residual: number;
    };

export type VanishOptions = {
  /**
   * 直線が消失点に整合しているとみなす **整合角** の上限(度)。
   *
   * 代数残差 |l·v| を使ってはならない —— 遠い消失点では v ≈ (dx, dy, ~0) に縮退し、
   * l·v ≈ cosθ·dx + sinθ·dy となって **ρ を一切見なくなる**。
   * 「角度が合えば位置がどれだけ離れていても内点」になり、偽の線束を取り込む
   * (実測 2026-08-31: 線を 13 本から 96 本へ増やすと誤差が 7.7 px → 1899 px)。
   *
   * 代わりに、線上の最近点から消失点へ向かう方向と、線の方向とのなす角を測る。
   */
  inlierAngleDeg: number;
  /** 消失点 1 つに必要な最小本数 */
  minSupport: number;
  /**
   * 有限とみなす距離の上限。**画面対角の何倍まで**を有限扱いにするか。
   * これを超えたら「無限遠」として返す —— 数を大きくすれば何でも有限になるので、
   * この値は主張の一部である(測る前に宣言する)。
   */
  finiteMaxDiagonals: number;
  /** 返す消失点の上限 */
  maxPoints: number;
};

/** 宣言値(2026-08-31)。閾値を後から緩めない */
export const VANISH_DEFAULTS: VanishOptions = {
  inlierAngleDeg: 1.5,
  minSupport: 3,
  finiteMaxDiagonals: 20,
  maxPoints: 4,
};

/** 直線を同次表現に直す。ノルムを 1 に揃える(cos²+sin² = 1 なので法線部は既に単位) */
function toHomogeneous(l: Line): [number, number, number] {
  return [Math.cos(l.theta), Math.sin(l.theta), -l.rho];
}

/**
 * 3×3 対称行列の固有分解(Jacobi 法)。
 * 固有値の昇順に並べた列ベクトルを返す。
 */
export function symmetricEigen(m: number[][]): { values: number[]; vectors: number[][] } {
  const a = m.map((r) => [...r]);
  let v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let sweep = 0; sweep < 64; sweep++) {
    let off = 0;
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) off += a[i][j] * a[i][j];
    if (off < 1e-30) break;
    for (let p = 0; p < 2; p++) {
      for (let q = p + 1; q < 3; q++) {
        if (Math.abs(a[p][q]) < 1e-30) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        const A = a.map((r) => [...r]);
        for (let k = 0; k < 3; k++) {
          a[p][k] = c * A[p][k] - s * A[q][k];
          a[q][k] = s * A[p][k] + c * A[q][k];
        }
        const B = a.map((r) => [...r]);
        for (let k = 0; k < 3; k++) {
          a[k][p] = c * B[k][p] - s * B[k][q];
          a[k][q] = s * B[k][p] + c * B[k][q];
        }
        const V = v.map((r) => [...r]);
        for (let k = 0; k < 3; k++) {
          v[k][p] = c * V[k][p] - s * V[k][q];
          v[k][q] = s * V[k][p] + c * V[k][q];
        }
      }
    }
  }
  const idx = [0, 1, 2].sort((i, j) => a[i][i] - a[j][j]);
  return {
    values: idx.map((i) => a[i][i]),
    vectors: idx.map((i) => [v[0][i], v[1][i], v[2][i]]),
  };
}

/** 直線群から最小二乗の消失点(同次)を出す */
function fitVanishing(lines: Line[]): [number, number, number] {
  const M = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (const l of lines) {
    const h = toHomogeneous(l);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) M[i][j] += h[i] * h[j];
  }
  const { vectors } = symmetricEigen(M);
  const v = vectors[0];
  const n = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / n, v[1] / n, v[2] / n];
}

/**
 * 直線と消失点の **整合角**(度)。
 *
 * 線 (θ, ρ) 上で画面中心に最も近い点は p = ρ·(cosθ, sinθ)、線の方向は d = (−sinθ, cosθ)。
 * 消失点が有限 (x, y) なら、p → 消失点 の向きが d と平行であるはず。
 * 無限遠なら、消失点の方向そのものが d と平行であるはず。
 * どちらの場合も **なす角** で測る —— 距離ではなく角なので、遠さで尺度が壊れない。
 */
function consistencyAngleDeg(l: Line, v: [number, number, number]): number {
  const ct = Math.cos(l.theta);
  const st = Math.sin(l.theta);
  const dx = -st;
  const dy = ct;
  let ux: number;
  let uy: number;
  if (Math.abs(v[2]) < 1e-12) {
    ux = v[0];
    uy = v[1];
  } else {
    ux = v[0] / v[2] - l.rho * ct;
    uy = v[1] / v[2] - l.rho * st;
  }
  const n = Math.hypot(ux, uy);
  if (n < 1e-12) return 0; // 消失点が線上の最近点そのもの
  const cos = Math.abs((ux * dx + uy * dy) / n);
  return (Math.acos(Math.min(1, cos)) * 180) / Math.PI;
}

/**
 * 直線群から消失点を推定する。
 *
 * 貪欲に「最も多くの直線を説明する 2 本組」を選び、整合する直線を集めて再当てはめ、
 * 使った直線を取り除いて繰り返す。決定論的で、乱数を使わない(G-04)。
 */
export function estimateVanishingPoints(
  lines: Line[],
  width: number,
  height: number,
  opts: VanishOptions = VANISH_DEFAULTS,
): VanishingPoint[] {
  if (lines.length < 2) return [];
  const diag = Math.hypot(width, height);
  const limit = diag * opts.finiteMaxDiagonals;

  // --- 第 1 段: 貪欲に種を作る -----------------------------------------
  // 「最も多くの直線を説明する 2 本組」を選び、使った直線を除いて繰り返す。
  const remaining = lines.map((l) => l);
  const seeds: [number, number, number][] = [];
  while (seeds.length < opts.maxPoints && remaining.length >= 2) {
    let best: { v: [number, number, number]; members: number[] } | null = null;
    for (let a = 0; a < remaining.length; a++) {
      for (let b = a + 1; b < remaining.length; b++) {
        const v = fitVanishing([remaining[a], remaining[b]]);
        const members: number[] = [];
        for (let k = 0; k < remaining.length; k++) {
          if (consistencyAngleDeg(remaining[k], v) <= opts.inlierAngleDeg) members.push(k);
        }
        if (!best || members.length > best.members.length) best = { v, members };
      }
    }
    if (!best || best.members.length < opts.minSupport) break;
    seeds.push(fitVanishing(best.members.map((k) => remaining[k])));
    const used = new Set(best.members);
    for (let k = remaining.length - 1; k >= 0; k--) if (used.has(k)) remaining.splice(k, 1);
  }
  if (seeds.length === 0) return [];

  // --- 第 2 段: 全直線を割り当て直して再当てはめる(交互最適化)-----------
  //
  // 貪欲な逐次割り当てだけでは、**二つの線束が角度域で重なったとき**に
  // 共有された直線を先に見つかった側が奪い、両方の推定が汚れる
  // (実測 2026-08-31: 89–93° を共有する 2 束で、片方が真値から 24 px ずれた)。
  // 全体を見てから割り当て直すと、この取り合いが解ける。
  let vps = seeds;
  let assign: number[][] = [];
  for (let iter = 0; iter < 8; iter++) {
    const next: number[][] = vps.map(() => []);
    for (let i = 0; i < lines.length; i++) {
      let bestIdx = -1;
      let bestAngle = opts.inlierAngleDeg;
      for (let j = 0; j < vps.length; j++) {
        const ang = consistencyAngleDeg(lines[i], vps[j]);
        if (ang <= bestAngle) {
          bestAngle = ang;
          bestIdx = j;
        }
      }
      if (bestIdx >= 0) next[bestIdx].push(i);
    }
    const same =
      assign.length === next.length &&
      assign.every((g, j) => g.length === next[j].length && g.every((x, k) => x === next[j][k]));
    assign = next;
    if (same) break;
    const refit: [number, number, number][] = [];
    for (let j = 0; j < vps.length; j++) {
      if (assign[j].length < opts.minSupport) continue;
      refit.push(fitVanishing(assign[j].map((i) => lines[i])));
    }
    if (refit.length === 0) return [];
    if (refit.length === vps.length) {
      vps = refit;
    } else {
      // 支持を失った消失点は捨てる。割り当ても作り直す
      vps = refit;
      assign = [];
    }
  }

  // --- 出力 --------------------------------------------------------------
  const out: VanishingPoint[] = [];
  for (let j = 0; j < vps.length; j++) {
    const idx = assign[j] ?? [];
    if (idx.length < opts.minSupport) continue;
    const member = idx.map((i) => lines[i]);
    const v = vps[j];
    const residual = member.reduce((s, l) => s + consistencyAngleDeg(l, v), 0) / member.length;
    const w = v[2];
    const dist = Math.hypot(v[0], v[1]) / Math.max(Math.abs(w), Number.MIN_VALUE);
    if (Math.abs(w) < Number.EPSILON || dist > limit) {
      let dirDeg = (Math.atan2(-v[0], v[1]) * 180) / Math.PI;
      dirDeg = ((dirDeg % 180) + 180) % 180;
      out.push({ kind: "infinite", dirDeg, support: member.length, residual });
    } else {
      const g = refineFinite(member, v[0] / w, v[1] / w);
      out.push({
        kind: "finite",
        x: g.x,
        y: g.y,
        support: member.length,
        residual,
        uncertaintyPx: finiteUncertainty(member, g.x, g.y),
      });
    }
  }
  return out;
}

/**
 * 有限の消失点を幾何的な最小二乗で詰める。
 * 各直線への符号付き距離 cosθ x + sinθ y − ρ の二乗和を最小化する(2×2 の正規方程式)。
 * 解が退化する(すべて平行)場合は、代数解をそのまま返す —— 黙って壊れた値を返さない。
 */
function refineFinite(lines: Line[], fallbackX: number, fallbackY: number): { x: number; y: number } {
  let a = 0;
  let b = 0;
  let c = 0;
  let d = 0;
  let e = 0;
  for (const l of lines) {
    const ct = Math.cos(l.theta);
    const st = Math.sin(l.theta);
    a += ct * ct;
    b += ct * st;
    c += st * st;
    d += ct * l.rho;
    e += st * l.rho;
  }
  const det = a * c - b * b;
  if (Math.abs(det) < 1e-12) return { x: fallbackX, y: fallbackY };
  return { x: (c * d - b * e) / det, y: (a * e - b * d) / det };
}

/**
 * 有限の消失点の位置の不確かさ(1σ の長軸、px)。
 *
 * 正規方程式 AᵀA の逆行列に残差分散を掛けた共分散の、最大固有値の平方根。
 * **線束が細いと AᵀA が退化に近づき、この値が跳ね上がる** ——
 * 「消失点はここだ」と言えない状況を、言えないまま数で出すための量である。
 */
function finiteUncertainty(lines: Line[], x: number, y: number): number {
  const n = lines.length;
  if (n < 3) return Infinity;
  let a = 0;
  let b = 0;
  let c = 0;
  let ss = 0;
  for (const l of lines) {
    const ct = Math.cos(l.theta);
    const st = Math.sin(l.theta);
    a += ct * ct;
    b += ct * st;
    c += st * st;
    const r = ct * x + st * y - l.rho;
    ss += r * r;
  }
  const det = a * c - b * b;
  if (!(Math.abs(det) > 0)) return Infinity;
  const sigma2 = ss / (n - 2); // 残差分散(自由度 2 を引く)
  // 共分散 = sigma2 · (AᵀA)⁻¹。2×2 の最大固有値
  const i11 = c / det;
  const i22 = a / det;
  const i12 = -b / det;
  const tr = i11 + i22;
  const dt = i11 * i22 - i12 * i12;
  const lmax = tr / 2 + Math.sqrt(Math.max(0, (tr * tr) / 4 - dt));
  return Math.sqrt(sigma2 * lmax);
}

/** 画面から見た消失点の位置。② の表示に使う */
export function describeVanishing(v: VanishingPoint, width: number, height: number): string {
  if (v.kind === "infinite") return `無限遠(向き ${v.dirDeg.toFixed(1)}°・${v.support} 本)`;
  const inside = Math.abs(v.x) <= width / 2 && Math.abs(v.y) <= height / 2;
  const unc = Number.isFinite(v.uncertaintyPx) ? ` ± ${v.uncertaintyPx.toFixed(0)} px` : " ±(定まらない)";
  return `(${v.x.toFixed(1)}, ${v.y.toFixed(1)})${unc}${inside ? " 画面内" : " 画面外"}・${v.support} 本`;
}
