// F-13 ④ 帰無仮説の実験室の集計。事前計算した数(data/scores/works.json)を群にまとめる。
//
// **群は鍵の接頭辞で決まる。**分類に判断を入れない ——
//   A-<objectID>          実作品(Met European Paintings の PD 絵画・層化抽出 200 件)
//   C-<壊し方>-<objectID> その作品の破壊版(トリム / 回転 / 鏡像)。**A と対応がつく**
//   P-<i>                 陽性対照(格子の交点に厳密配置)
//   D-<i>                 無作為矩形分割
//   E-<i>                 1/f ノイズ
//
// 効果量は Cohen's d と Cliff's δ の両方を出す。**p 値だけにしない**(SPEC §7 の ④)。

import { cliffsDelta, cohensD, pairedT, permutationBand } from "./tscan";

export type WorkScore = {
  key: string;
  width: number;
  height: number;
  points: number;
  z: Record<string, number>;
  df: Record<string, number[]>;
  scanV: number[];
  scanH: number[];
};

export type ScoreFile = {
  trials: number;
  seed: number;
  tMin: number;
  tMax: number;
  tStep: number;
  kinds: string[];
  dfGrids: string[];
  works: WorkScore[];
};

export const GROUP_IDS = ["A", "C-trim", "C-rotate", "C-mirror", "P", "D", "E"] as const;
export type GroupId = (typeof GROUP_IDS)[number];

export const GROUP_LABEL: Record<GroupId, string> = {
  A: "実作品(絵画一般)",
  "C-trim": "破壊版 トリム 20 %",
  "C-rotate": "破壊版 回転 12°",
  "C-mirror": "破壊版 鏡像",
  P: "陽性対照(格子の交点に配置)",
  D: "無作為矩形分割",
  E: "1/f ノイズ",
};

/** 鍵から群を決める。判断を入れない */
export function groupOf(key: string): GroupId | null {
  if (key.startsWith("A-")) return "A";
  if (key.startsWith("C-trim-")) return "C-trim";
  if (key.startsWith("C-rotate-")) return "C-rotate";
  if (key.startsWith("C-mirror-")) return "C-mirror";
  if (key.startsWith("P-")) return "P";
  if (key.startsWith("D-")) return "D";
  if (key.startsWith("E-")) return "E";
  return null;
}

/** A 群の作品 ID(C 群と対応をつけるのに使う) */
export function objectIdOf(key: string): string | null {
  const m = key.match(/^(?:A|C-(?:trim|rotate|mirror))-(\d+)$/);
  return m ? m[1] : null;
}

export function byGroup(file: ScoreFile): Map<GroupId, WorkScore[]> {
  const out = new Map<GroupId, WorkScore[]>();
  for (const g of GROUP_IDS) out.set(g, []);
  for (const w of file.works) {
    const g = groupOf(w.key);
    if (g) out.get(g)!.push(w);
  }
  return out;
}

export type GroupSummary = {
  group: GroupId;
  n: number;
  mean: number;
  sd: number;
  median: number;
  q1: number;
  q3: number;
  min: number;
  max: number;
};

function quantileOf(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function summarize(group: GroupId, values: number[]): GroupSummary {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  const mean = n ? s.reduce((a, b) => a + b, 0) / n : NaN;
  const sd =
    n > 1 ? Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : NaN;
  return {
    group,
    n,
    mean,
    sd,
    median: quantileOf(s, 0.5),
    q1: quantileOf(s, 0.25),
    q3: quantileOf(s, 0.75),
    min: s[0],
    max: s[n - 1],
  };
}

/** 格子 1 種について、群ごとの z をまとめる */
export function groupSummaries(file: ScoreFile, kind: string): GroupSummary[] {
  const g = byGroup(file);
  return GROUP_IDS.map((id) => summarize(id, (g.get(id) ?? []).map((w) => w.z[kind] ?? NaN).filter(Number.isFinite)));
}

export type Contrast = {
  a: GroupId;
  b: GroupId;
  n: number;
  d: number;
  delta: number;
  meanDiff: number;
};

/** 2 群の対比。効果量は d と δ の両方(**p 値だけにしない**) */
export function contrast(file: ScoreFile, kind: string, a: GroupId, b: GroupId): Contrast {
  const g = byGroup(file);
  const va = (g.get(a) ?? []).map((w) => w.z[kind]).filter(Number.isFinite);
  const vb = (g.get(b) ?? []).map((w) => w.z[kind]).filter(Number.isFinite);
  return {
    a,
    b,
    n: Math.min(va.length, vb.length),
    d: cohensD(va, vb),
    delta: cliffsDelta(va, vb),
    meanDiff: va.reduce((s, x) => s + x, 0) / va.length - vb.reduce((s, x) => s + x, 0) / vb.length,
  };
}

export type PairedContrast = Contrast & { t: number; pairs: number };

/**
 * G-10。A 群とその破壊版の **対応あり**の対比。
 * 対応が取れない作品は落とす —— **黙って別の作品と組ませない**。
 */
export function pairedContrast(file: ScoreFile, kind: string, destroyed: GroupId): PairedContrast {
  const g = byGroup(file);
  const aMap = new Map<string, number>();
  for (const w of g.get("A") ?? []) {
    const id = objectIdOf(w.key);
    if (id && Number.isFinite(w.z[kind])) aMap.set(id, w.z[kind]);
  }
  const av: number[] = [];
  const bv: number[] = [];
  for (const w of g.get(destroyed) ?? []) {
    const id = objectIdOf(w.key);
    if (!id || !aMap.has(id) || !Number.isFinite(w.z[kind])) continue;
    av.push(aMap.get(id)!);
    bv.push(w.z[kind]);
  }
  const pt = pairedT(av, bv);
  return {
    a: "A",
    b: destroyed,
    n: av.length,
    pairs: av.length,
    d: av.length > 1 ? cohensD(av, bv) : NaN,
    delta: cliffsDelta(av, bv),
    meanDiff: pt.meanDiff,
    t: pt.t,
  };
}

/** 自由度の会計。群ごとに M0 → M1 → M3 → M5 の平均 z */
export function dfLadder(file: ScoreFile, kind: string): { group: GroupId; steps: number[]; n: number }[] {
  const g = byGroup(file);
  return GROUP_IDS.map((id) => {
    const rows = (g.get(id) ?? []).map((w) => w.df?.[kind]).filter((v): v is number[] => Array.isArray(v));
    const steps = [0, 1, 2, 3].map((i) =>
      rows.length ? rows.reduce((s, r) => s + r[i], 0) / rows.length : NaN,
    );
    return { group: id, steps, n: rows.length };
  });
}

export type ScanSummary = {
  ts: number[];
  /** A 群の平均曲線 */
  observed: number[];
  /** 順列帰無から作った 95 % 帯 */
  lo: number[];
  hi: number[];
  /** 帯の外に出た t */
  outside: { t: number; z: number; side: "上" | "下" }[];
};

/**
 * G-目玉1。A 群の走査曲線が **順列帰無の帯** を出るか。
 * **閾値を置かない。出ても出なくても成果である**(SPEC §4)。
 *
 * 帰無は「各作品の曲線の t ラベルを入れ替えたもの」の平均。
 * z の周辺分布はそのままに、**t の構造だけを壊す** ——
 * したがってこの帯を出ることは「曲線が t について平坦でない」を意味する。
 *
 * **1/f ノイズ群と比べる帯ではない。**それを使うと、実作品とノイズの
 * *水準* の差(当然ある)で曲線が全域にわたって帯を外れ、
 * 「どの比が特別か」ではなく「絵はノイズと違うか」を測ってしまう
 * —— 実測 2026-08-31 で縦 109/181・横 170/181 が外れた。水準の差は §4 の問いではない。
 */
export function scanSummary(file: ScoreFile, orientation: "V" | "H"): ScanSummary {
  const g = byGroup(file);
  const pick = (w: WorkScore) => (orientation === "V" ? w.scanV : w.scanH);
  const a = (g.get("A") ?? []).map(pick).filter((v): v is number[] => Array.isArray(v) && v.length > 0);
  if (a.length === 0) throw new Error("A 群の曲線が無い");
  const m = a[0].length;
  const ts = Array.from({ length: m }, (_, i) => file.tMin + i * file.tStep);
  const observed = Array.from({ length: m }, (_, i) => a.reduce((s, c) => s + c[i], 0) / a.length);

  const band = permutationBand(permutedMeans(a, file.seed, 400), 0.95);
  const outside: ScanSummary["outside"] = [];
  for (let i = 0; i < m; i++) {
    if (observed[i] > band.hi[i]) outside.push({ t: ts[i], z: observed[i], side: "上" });
    else if (observed[i] < band.lo[i]) outside.push({ t: ts[i], z: observed[i], side: "下" });
  }
  return { ts, observed, lo: band.lo, hi: band.hi, outside };
}

/**
 * 順列帰無。各曲線の値を **t について並べ替えて**から平均する。
 * 曲線ごとの z の分布(平均・散らばり・裾)はそのまま保たれるので、
 * 帯は「t の構造が無いとき、平均曲線がどれだけ揺れるか」を表す。
 */
function permutedMeans(curves: number[][], seed: number, reps: number): number[][] {
  const m = curves[0].length;
  let a = seed >>> 0;
  const rnd = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out: number[][] = [];
  for (let b = 0; b < reps; b++) {
    const acc = new Array(m).fill(0);
    for (const c of curves) {
      const p = [...c];
      for (let i = p.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [p[i], p[j]] = [p[j], p[i]];
      }
      for (let i = 0; i < m; i++) acc[i] += p[i];
    }
    out.push(acc.map((v) => v / curves.length));
  }
  return out;
}

/**
 * 別の測定 —— **実作品と 1/f ノイズの水準の差**。
 * §4 の問い(どの比が特別か)とは別物だが、それはそれで実測なので残す。
 */
export function levelGap(file: ScoreFile, orientation: "V" | "H"): { meanA: number; meanE: number; gap: number } {
  const g = byGroup(file);
  const pick = (w: WorkScore) => (orientation === "V" ? w.scanV : w.scanH);
  const flat = (id: "A" | "E") =>
    (g.get(id) ?? [])
      .map(pick)
      .filter((v): v is number[] => Array.isArray(v) && v.length > 0)
      .flat();
  const va = flat("A");
  const ve = flat("E");
  const mA = va.reduce((s, x) => s + x, 0) / va.length;
  const mE = ve.reduce((s, x) => s + x, 0) / ve.length;
  return { meanA: mA, meanE: mE, gap: mA - mE };
}

/**
 * **§4 の問いに答え切るための一段。**
 *
 * 走査曲線は実測で **中央に頂点を持つなだらかな単峰**だった
 * (実測 2026-08-31: 縦は t=0.465 で z=0.227、横は t=0.515 で z=0.202)。
 * これは「画面の中央にエッジが集まる」という当たり前の構造であって、
 * **比の構造ではない。**順列帰無の帯は「曲線が平坦か」しか答えないので、
 * この山があるだけで大量の点が帯を外れる(実測 121/181・124/181)。
 *
 * したがって **なだらかな傾向を引いてから**、謳われた比の位置に
 * 局所的な突起があるかを見る。σ は短辺の 1 % なので、比に当たる突起は
 * t にして 0.01–0.02 幅になる —— 窓 0.3 の移動平均は山を消し、突起を残す。
 */
export function detrend(curve: number[], windowPoints: number): number[] {
  const half = Math.max(1, Math.floor(windowPoints / 2));
  return curve.map((_, i) => {
    let sum = 0;
    let n = 0;
    for (let j = i - half; j <= i + half; j++) {
      if (j < 0 || j >= curve.length) continue;
      sum += curve[j];
      n++;
    }
    return curve[i] - sum / n;
  });
}

export type RatioVerdict = {
  name: string;
  t: number;
  residual: number;
  /** 順列帰無の帯(残差)を出たか */
  outside: boolean;
  lo: number;
  hi: number;
};

/**
 * G-目玉1 の本体。**謳われた比の位置に、なだらかな傾向を超える突起があるか。**
 *
 * 比の一覧はここに書く —— **走査側(tscan.ts)には置かない**。
 * 走査はどの比も知らずに 181 点を測り、判定の段で初めて名前が付く(SPEC §4)。
 */
export function ratioVerdicts(
  file: ScoreFile,
  orientation: "V" | "H",
  windowT = 0.3,
): { verdicts: RatioVerdict[]; residual: number[]; lo: number[]; hi: number[]; ts: number[]; outsideCount: number } {
  const g = byGroup(file);
  const pick = (w: WorkScore) => (orientation === "V" ? w.scanV : w.scanH);
  const a = (g.get("A") ?? []).map(pick).filter((v): v is number[] => Array.isArray(v) && v.length > 0);
  if (a.length === 0) throw new Error("A 群の曲線が無い");
  const m = a[0].length;
  const ts = Array.from({ length: m }, (_, i) => file.tMin + i * file.tStep);
  const win = Math.round(windowT / file.tStep);

  const observed = detrend(
    Array.from({ length: m }, (_, i) => a.reduce((s, c) => s + c[i], 0) / a.length),
    win,
  );
  const nullCurves = permutedMeans(a, file.seed + 1, 400).map((c) => detrend(c, win));
  const band = permutationBand(nullCurves, 0.95);

  const GOLDEN = (1 + Math.sqrt(5)) / 2;
  const named: { name: string; t: number }[] = [
    { name: "三分割 1/3", t: 1 / 3 },
    { name: "三分割 2/3", t: 2 / 3 },
    { name: "黄金 0.382", t: 1 - 1 / GOLDEN },
    { name: "黄金 0.618", t: 1 / GOLDEN },
    { name: "√2 矩形", t: 1 - 1 / Math.SQRT2 },
    { name: "√5 矩形", t: 1 - 1 / Math.sqrt(5) },
    { name: "中央 0.5", t: 0.5 },
  ];
  const verdicts = named.map(({ name, t }) => {
    let best = 0;
    for (let i = 1; i < m; i++) if (Math.abs(ts[i] - t) < Math.abs(ts[best] - t)) best = i;
    return {
      name,
      t: ts[best],
      residual: observed[best],
      lo: band.lo[best],
      hi: band.hi[best],
      outside: observed[best] > band.hi[best] || observed[best] < band.lo[best],
    };
  });
  let outsideCount = 0;
  for (let i = 0; i < m; i++) if (observed[i] > band.hi[i] || observed[i] < band.lo[i]) outsideCount++;
  return { verdicts, residual: observed, lo: band.lo, hi: band.hi, ts, outsideCount };
}
