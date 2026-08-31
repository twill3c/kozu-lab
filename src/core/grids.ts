// F-04 格子生成器。**規範層**(SPEC §2)—— 絵の中に描かれてはいない、見る側が重ねる格子である。
//
// 比の定数(0.618 など)はこのファイルにだけ置く。L4 の t 走査(T-310)は
// 「走査側に比の定数が現れない」ことを検査するので、その境界をここで引いておく。
//
// 座標系は画像中心原点、x cosθ + y sinθ = ρ。交点は **線の交わりから導出する** ——
// 座標を定数で書けば、検査は「自分の書いた定数と一致する」だけになる(T-008)。

import type { Line, Point } from "./image";
import type { Rng } from "./rng";

export const GOLDEN = (1 + Math.sqrt(5)) / 2; // 1.618…
/** 黄金分割の切り位置(画面幅に対する比)。0.382 と 0.618 */
export const GOLDEN_CUTS = [1 - 1 / GOLDEN, 1 / GOLDEN] as const;

export type Grid = {
  id: string;
  name: string;
  lines: Line[];
  points: Point[];
  lineCount: number;
};

export const GRID_KINDS = [
  "thirds",
  "golden",
  "root2",
  "root3",
  "root5",
  "diagonal",
  "hambidge",
  "armature",
  "whirling",
] as const;

export type GridKind = (typeof GRID_KINDS)[number];

const NAMES: Record<GridKind, string> = {
  thirds: "三分割法",
  golden: "黄金分割",
  root2: "√2 矩形",
  root3: "√3 矩形",
  root5: "√5 矩形",
  diagonal: "対角線法",
  hambidge: "動的対称(Hambidge)",
  armature: "アルマチュア(Barnstone)",
  whirling: "回転する正方形(黄金螺旋の作図線)",
};

/** 2 直線の交点。平行なら null */
export function intersect(a: Line, b: Line): Point | null {
  const ca = Math.cos(a.theta);
  const sa = Math.sin(a.theta);
  const cb = Math.cos(b.theta);
  const sb = Math.sin(b.theta);
  const det = ca * sb - sa * cb;
  if (Math.abs(det) < 1e-12) return null;
  return {
    x: (a.rho * sb - b.rho * sa) / det,
    y: (b.rho * ca - a.rho * cb) / det,
  };
}

/** 点 p を通り方向 d の直線を (θ, ρ) にする */
function through(p: Point, dx: number, dy: number): Line {
  // 法線は方向の直交。θ ∈ [0, π) へ畳む
  let theta = Math.atan2(dx, -dy);
  let rho = p.x * Math.cos(theta) + p.y * Math.sin(theta);
  while (theta < 0) {
    theta += Math.PI;
    rho = -rho;
  }
  while (theta >= Math.PI) {
    theta -= Math.PI;
    rho = -rho;
  }
  return { theta, rho };
}

/** 縦線 x = a(画面中心原点) */
const vertical = (a: number): Line => ({ theta: 0, rho: a });
/** 横線 y = b */
const horizontal = (b: number): Line => ({ theta: Math.PI / 2, rho: b });

/** 画面比 f(0–1)での縦横の切り。中心原点に直す */
function cuts(fracs: readonly number[], W: number, H: number): Line[] {
  const out: Line[] = [];
  for (const f of fracs) {
    out.push(vertical((f - 0.5) * W));
    out.push(horizontal((f - 0.5) * H));
  }
  return out;
}

function corners(W: number, H: number): Point[] {
  return [
    { x: -W / 2, y: -H / 2 },
    { x: W / 2, y: -H / 2 },
    { x: W / 2, y: H / 2 },
    { x: -W / 2, y: H / 2 },
  ];
}

function buildLines(kind: GridKind, W: number, H: number): Line[] {
  switch (kind) {
    case "thirds":
      return cuts([1 / 3, 2 / 3], W, H);
    case "golden":
      return cuts(GOLDEN_CUTS, W, H);
    case "root2":
      return cuts([1 - 1 / Math.SQRT2, 1 / Math.SQRT2], W, H);
    case "root3":
      return cuts([1 - 1 / Math.sqrt(3), 1 / Math.sqrt(3)], W, H);
    case "root5":
      return cuts([1 - 1 / Math.sqrt(5), 1 / Math.sqrt(5)], W, H);
    case "diagonal": {
      // 対角線 2 本 + 四隅からの 45° 線 4 本(Westhoff の対角線法)
      const c = corners(W, H);
      return [
        through(c[0], W, H),
        through(c[1], -W, H),
        through(c[0], 1, 1),
        through(c[1], -1, 1),
        through(c[2], -1, -1),
        through(c[3], 1, -1),
      ];
    }
    case "hambidge": {
      // 全体の対角線 2 本 + 各対角線への隅からの垂線 4 本。
      // 動的対称の第一段(相反矩形を切り出す作図)にあたる
      const c = corners(W, H);
      const d1 = through(c[0], W, H);
      const d2 = through(c[1], -W, H);
      const perp = (l: Line, p: Point): Line => through(p, Math.cos(l.theta), Math.sin(l.theta));
      return [d1, d2, perp(d1, c[1]), perp(d1, c[3]), perp(d2, c[0]), perp(d2, c[2])];
    }
    case "armature": {
      // Barnstone のアルマチュア。**定義は著者によって幅がある**ので、本プロジェクトの採用を宣言しておく:
      // 対角線 2 本 + 縦横の中線 2 本 + 各隅から対辺の中点へ引く 8 本 = 12 本
      const c = corners(W, H);
      const mid: Point[] = [
        { x: 0, y: -H / 2 },
        { x: W / 2, y: 0 },
        { x: 0, y: H / 2 },
        { x: -W / 2, y: 0 },
      ];
      const out: Line[] = [through(c[0], W, H), through(c[1], -W, H), vertical(0), horizontal(0)];
      for (const p of c) {
        for (const m of mid) {
          const dx = m.x - p.x;
          const dy = m.y - p.y;
          if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) continue;
          // 隅に接する辺の中点(隅と同じ辺上)へは引かない
          if (Math.abs(dx) < 1e-9 || Math.abs(dy) < 1e-9) continue;
          out.push(through(p, dx, dy));
        }
      }
      return dedupeLines(out);
    }
    case "whirling": {
      // 黄金螺旋そのものは曲線であり、線の集合では表せない。
      // **本プロジェクトが重ねるのは螺旋の作図線(回転する正方形の切り)である。**
      // 螺旋の曲線は画面には描くが、当てはまりスコアには入らない(SPEC §5)。
      const out: Line[] = [];
      let x0 = -W / 2;
      let y0 = -H / 2;
      let w = W;
      let h = H;
      for (let i = 0; i < 6; i++) {
        if (i % 2 === 0) {
          const cut = x0 + w / GOLDEN;
          out.push(vertical(cut));
          x0 = cut;
          w -= w / GOLDEN;
        } else {
          const cut = y0 + h / GOLDEN;
          out.push(horizontal(cut));
          y0 = cut;
          h -= h / GOLDEN;
        }
      }
      return out;
    }
  }
}

function dedupeLines(lines: Line[]): Line[] {
  const seen = new Set<string>();
  const out: Line[] = [];
  for (const l of lines) {
    const k = `${l.theta.toFixed(9)},${l.rho.toFixed(9)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(l);
  }
  return out;
}

/** 線集合から画面内の交点を導出する。**定数で書かない**(T-008) */
export function derivePoints(lines: Line[], W: number, H: number): Point[] {
  const out: Point[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const p = intersect(lines[i], lines[j]);
      if (!p) continue;
      if (Math.abs(p.x) > W / 2 + 1e-6 || Math.abs(p.y) > H / 2 + 1e-6) continue;
      const k = `${p.x.toFixed(6)},${p.y.toFixed(6)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(p);
    }
  }
  return out;
}

export function buildGrid(kind: GridKind, W: number, H: number): Grid {
  const lines = buildLines(kind, W, H);
  return {
    id: kind,
    name: NAMES[kind],
    lines,
    points: derivePoints(lines, W, H),
    lineCount: lines.length,
  };
}

/**
 * 帰無分布用のランダム格子(SPEC §5.1)。
 * 角度は既定で一様。`angles` を渡すと **同じ角度分布** を保ったまま ρ だけを振る。
 */
export function randomGrid(lineCount: number, W: number, H: number, rng: Rng, angles?: number[]): Grid {
  const lines: Line[] = [];
  for (let i = 0; i < lineCount; i++) {
    const theta = angles ? angles[i % angles.length] : rng() * Math.PI;
    const support = (W / 2) * Math.abs(Math.cos(theta)) + (H / 2) * Math.abs(Math.sin(theta));
    lines.push({ theta, rho: (rng() * 2 - 1) * support });
  }
  return { id: "random", name: "ランダム格子", lines, points: derivePoints(lines, W, H), lineCount };
}
