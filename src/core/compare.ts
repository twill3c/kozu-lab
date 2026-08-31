// F-15 ⑦ 作品くらべ。**客観層だけで作る**(SPEC §2)。
//
// 出す量は 3 つ:
//   - 角度ヒストグラム(水平・垂直・対角の別)
//   - 明度重心の位置(中心からのずれ)
//   - 対角優位度 —— 対角の線が全体に占める割合
//
// **時代で比べる。**標本枠は世紀の層で採ってあるので、層をそのまま比較の軸に使える。
// 群の分け方に判断が入らない(SPEC §8.2 と同じ構え)。

import type { Line } from "./image";

export const ANGLE_CLASSES = ["水平", "垂直", "対角"] as const;
export type AngleClass = (typeof ANGLE_CLASSES)[number];

/**
 * 直線を 3 種に分ける。境界は宣言値 ——
 * 垂直は 0°±15°、水平は 90°±15°、残りが対角。
 * **境界の置き方で結果は動く。**動かしたときにどう変わるかは画面で見せる。
 */
export function classifyAngle(theta: number, marginDeg = 15): AngleClass {
  const deg = ((theta * 180) / Math.PI + 180) % 180;
  if (deg < marginDeg || deg >= 180 - marginDeg) return "垂直";
  if (Math.abs(deg - 90) < marginDeg) return "水平";
  return "対角";
}

export type AngleProfile = Record<AngleClass, number> & { total: number; diagonalShare: number };

/**
 * 画面の縁に寄った線を落とす割合(宣言値)。
 *
 * **絵の縁そのものが長い直線として立つ。**実測(2026-08-31、20 作品 363 本):
 * 縁から 6 % 以内に 102 本(28.1 %)あり、**そのすべてが水平か垂直**だった。
 * これを数に入れると「西洋絵画は対角が少ない」という結論が **撮影の性質** から出る。
 */
export const BORDER_MARGIN = 0.06;

/** 線が画面の縁に寄っているか。ρ を θ 方向の支持関数で正規化して測る */
export function isNearBorder(line: Line, width: number, height: number, margin = BORDER_MARGIN): boolean {
  const support =
    (width / 2) * Math.abs(Math.cos(line.theta)) + (height / 2) * Math.abs(Math.sin(line.theta));
  if (!(support > 0)) return true;
  return Math.abs(line.rho) / support > 1 - margin;
}

export function angleProfile(lines: Line[], marginDeg = 15): AngleProfile {
  const counts: Record<AngleClass, number> = { 水平: 0, 垂直: 0, 対角: 0 };
  for (const l of lines) counts[classifyAngle(l.theta, marginDeg)]++;
  const total = lines.length;
  return { ...counts, total, diagonalShare: total ? counts.対角 / total : NaN };
}

/** 縁を除いてから数える。**除く前も一緒に返す** —— 数がどれだけ動いたかを隠さない */
export function angleProfileInterior(
  lines: Line[],
  width: number,
  height: number,
  margin = BORDER_MARGIN,
  marginDeg = 15,
): { all: AngleProfile; interior: AngleProfile; removed: number } {
  const interior = lines.filter((l) => !isNearBorder(l, width, height, margin));
  return {
    all: angleProfile(lines, marginDeg),
    interior: angleProfile(interior, marginDeg),
    removed: lines.length - interior.length,
  };
}

/**
 * 世紀の層。**標本枠(data/frames/met-ep.json)が刻んだ規則と同じ**にする ——
 * 「objectBeginDate と objectEndDate の中点の世紀」で floor(中点/100)+1。
 *
 * 慣用の数え方(1900 年は 19 世紀)とは **境界が 1 年ずれる**。
 * 枠は既にこの規則で作られているので、こちらを合わせる。直すなら枠から作り直す。
 */
export function centuryOf(beginDate: number, endDate: number): string {
  if (!Number.isFinite(beginDate) || !Number.isFinite(endDate)) return "不明";
  return `${Math.floor((beginDate + endDate) / 2 / 100) + 1}世紀`;
}
