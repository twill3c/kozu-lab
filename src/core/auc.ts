// AUC-Judd。顕著性マップが注視点をどれだけ当てるかの標準的な指標。
//
// 注視点の位置でのマップ値をしきい値として走査し、
// **各しきい値で「注視点のうち拾えた割合」と「画面全体のうち拾った割合」**の曲線の下面積を取る。
// 完全な予測で 1、無情報で 0.5、完全に逆で 0。
//
// **注視点が無ければ例外。**黙って 0.5 を返すと「較正できた」ように見えてしまう(HC-097)。

export type Fixation = { x: number; y: number };

export function aucJudd(map: Float64Array, width: number, height: number, fixations: Fixation[]): number {
  if (fixations.length === 0) throw new Error("注視点が 1 つも無い —— 黙って 0.5 を返さない");
  const n = width * height;
  if (map.length !== n) throw new Error(`マップの大きさが合わない: ${map.length} と ${n}`);

  const inside = fixations.filter((f) => f.x >= 0 && f.x < width && f.y >= 0 && f.y < height);
  if (inside.length === 0) throw new Error("画面内の注視点が 1 つも無い");

  // **順位に基づく定義を使う**(Mann–Whitney):
  //   AUC = P(注視点の値 > 任意画素の値) + 0.5 × P(等しい)
  // しきい値を掃く書き方は **同値の扱いを間違えやすい** —— 一様なマップで 0.25 が出た
  // (正しくは 0.5)。順位で書けば同値が定義に明示的に現れる。
  // 陰性集合は **画面の全画素**(AUC-Judd の定義)。
  const positives = inside.map((f) => map[Math.floor(f.y) * width + Math.floor(f.x)]);
  const sorted = Array.from(map).sort((a, b) => a - b);

  /** sorted のうち v より小さい個数と、v に等しい個数 */
  const lower = (v: number): number => {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] < v) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const upper = (v: number): number => {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] <= v) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  let acc = 0;
  for (const v of positives) {
    const lt = lower(v);
    const eq = upper(v) - lt;
    acc += (lt + 0.5 * eq) / n;
  }
  return acc / positives.length;
}
