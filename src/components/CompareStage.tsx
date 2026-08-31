"use client";

// ⑦ 作品くらべ(F-15 / SPEC §7)。客観層だけで作る。
//
// **時代で比べる。**標本枠は世紀の層で採ってあるので、層をそのまま比較の軸に使える ——
// 群の分け方に判断が入らない。
//
// **縁の線は落としてある。**絵の縁そのものが長い直線として立ち、実測でその 100 % が
// 水平か垂直だった(20 作品 363 本のうち 102 本が縁から 6 % 以内、対角は 0 本)。
// 落とさずに数えると「西洋絵画は対角が少ない」という結論が **撮影の性質** から出る。
// 落とす前の値も並べて出す —— 数がどれだけ動いたかを隠さない。

import { useMemo, useState } from "react";
import { layerStyle } from "@/core/overlay";
import compare from "@/data/compare.json";

type Work = {
  objectID: number;
  title: string;
  artist: string;
  century: string;
  lines: number;
  linesInterior: number;
  borderRemoved: number;
  horizontal: number;
  vertical: number;
  diagonal: number;
  diagonalShare: number | null;
  diagonalShareAll: number | null;
  centroidX: number | null;
  centroidY: number | null;
};
type CompareFile = { note: string; shortSide: number; dropped: number; works: Work[] };

const FILE = compare as unknown as CompareFile;

function median(v: number[]): number {
  if (v.length === 0) return NaN;
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

type Metric = "diagonalShare" | "centroidX" | "centroidY" | "linesInterior";
const METRICS: { id: Metric; label: string; note: string }[] = [
  { id: "diagonalShare", label: "対角優位度", note: "検出線のうち対角(垂直 ±15°・水平 ±15° の外)の割合" },
  { id: "centroidX", label: "明度重心 x", note: "短辺で正規化。正なら右寄り" },
  { id: "centroidY", label: "明度重心 y", note: "短辺で正規化。正なら下寄り" },
  { id: "linesInterior", label: "検出直線数", note: "縁を除いた本数" },
];

export default function CompareStage() {
  const [metric, setMetric] = useState<Metric>("diagonalShare");

  const byCentury = useMemo(() => {
    const m = new Map<string, Work[]>();
    for (const w of FILE.works) {
      if (!m.has(w.century)) m.set(w.century, []);
      m.get(w.century)!.push(w);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], "ja", { numeric: true }));
  }, []);

  const rows = byCentury.map(([century, works]) => {
    const vals = works.map((w) => w[metric]).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    return { century, n: works.length, used: vals.length, median: median(vals), vals };
  });

  const all = rows.flatMap((r) => r.vals);
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const obj = layerStyle("objective");
  const W = 760;
  const H = 260;
  const x = (i: number) => 70 + (i * (W - 100)) / Math.max(1, rows.length - 1);
  const y = (v: number) => H - 40 - ((v - lo) / (hi - lo || 1)) * (H - 70);

  const borderRemoved = FILE.works.reduce((s, w) => s + w.borderRemoved, 0);
  const totalLines = FILE.works.reduce((s, w) => s + w.lines, 0);
  const shareAll = median(FILE.works.map((w) => w.diagonalShareAll).filter((v): v is number => typeof v === "number" && Number.isFinite(v)));
  const shareInterior = median(FILE.works.map((w) => w.diagonalShare).filter((v): v is number => typeof v === "number" && Number.isFinite(v)));
  const zeroInterior = FILE.works.filter((w) => w.linesInterior === 0).length;
  const withDiagonal = FILE.works.filter((w) => w.diagonal > 0).length;
  const medianInterior = median(FILE.works.map((w) => w.linesInterior));
  const medianAll = median(FILE.works.map((w) => w.lines));

  return (
    <>
      <div className="controls">
        <div className="control">
          <label htmlFor="metric">見る量</label>
          <select id="metric" value={metric} onChange={(e) => setMetric(e.target.value as Metric)}>
            {METRICS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="note">{METRICS.find((m) => m.id === metric)!.note}</p>

      <div className="stage">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="世紀ごとの分布">
          {rows.map((r, i) => (
            <g key={r.century}>
              {r.vals.map((v, j) => (
                <circle key={j} cx={x(i)} cy={y(v)} r={2} fill={obj.stroke} opacity={0.25} />
              ))}
              <line
                x1={x(i) - 18}
                y1={y(r.median)}
                x2={x(i) + 18}
                y2={y(r.median)}
                stroke={obj.stroke}
                strokeWidth={2}
              />
              <text x={x(i)} y={H - 20} fontSize={10} textAnchor="middle" fill="currentColor" opacity={0.75}>
                {r.century}
              </text>
              <text x={x(i)} y={H - 8} fontSize={8} textAnchor="middle" fill="currentColor" opacity={0.5}>
                n={r.n}
              </text>
            </g>
          ))}
        </svg>
      </div>

      <table>
        <thead>
          <tr>
            <th>世紀</th>
            <th className="num">n</th>
            <th className="num">中央値</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.century}>
              <th>{r.century}</th>
              <td className="num">{r.n}</td>
              <td className="num">{Number.isFinite(r.median) ? r.median.toFixed(3) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>そもそも直線が足りない</h2>
      <p className="note">
        ⑦ の当初の狙いは「時代や流派の傾向を数値で示す」だった。
        <strong>測ったらそうならなかった</strong> —— 実作品には、直線検出という道具が前提している対象が薄い。
        絵の中の輪郭は曲がり、途切れ、筆触で散る。
      </p>
      <table>
        <tbody>
          <tr>
            <th>縁を除くと直線が 0 本になる作品</th>
            <td className="num">
              <strong>
                {zeroInterior} / {FILE.works.length}
              </strong>
            </td>
            <td className="note">{((zeroInterior / FILE.works.length) * 100).toFixed(1)} %</td>
          </tr>
          <tr>
            <th>対角が 1 本以上ある作品</th>
            <td className="num">
              {withDiagonal} / {FILE.works.length}
            </td>
            <td className="note">{((withDiagonal / FILE.works.length) * 100).toFixed(1)} %</td>
          </tr>
          <tr>
            <th>縁を除いた直線数(中央値)</th>
            <td className="num">{medianInterior}</td>
            <td className="note">落とす前は {medianAll} 本</td>
          </tr>
        </tbody>
      </table>
      <p className="note">
        <strong>これは器械の欠陥ではない。</strong>合成のステップエッジに対しては Δρ 0.66 px まで
        当てられる検出器が(設計図 §11.2)、実作品では材料そのものを見つけられない ——
        <strong>「構図線」が実作品に頑健な直線として在るわけではない</strong>、ということである。
        ④ が「重ねた格子は当たらない」と言い、⑦ は「重ねる先の線がそもそも乏しい」と言っている。
      </p>

      <h2>縁の線を落とした効果</h2>
      <p className="note">
        絵の縁そのものが長い直線として立つ。実測で <strong>縁から 6 % 以内の線はすべて水平か垂直</strong>
        だった(20 作品 363 本中 102 本、対角は 0 本)。落とさずに数えると
        「西洋絵画は対角が少ない」という結論が <strong>撮影の性質</strong> から出てしまう。
      </p>
      <table>
        <tbody>
          <tr>
            <th>落とした線</th>
            <td className="num">
              {borderRemoved} / {totalLines}
            </td>
            <td className="note">全 {FILE.works.length} 作品の合計({((borderRemoved / totalLines) * 100).toFixed(1)} %)</td>
          </tr>
          <tr>
            <th>対角優位度(落とす前)</th>
            <td className="num">{Number.isFinite(shareAll) ? shareAll.toFixed(3) : "—"}</td>
            <td className="note">中央値</td>
          </tr>
          <tr>
            <th>対角優位度(落とした後)</th>
            <td className="num">
              <strong>{Number.isFinite(shareInterior) ? shareInterior.toFixed(3) : "—"}</strong>
            </td>
            <td className="note">中央値。これを ⑦ の値として使う</td>
          </tr>
        </tbody>
      </table>

      <p className="note">
        実作品 {FILE.works.length} 件(取りこぼし {FILE.dropped} 件)。短辺 {FILE.shortSide} px へ正規化してから測っている。
        <strong>画像は配っていない</strong> —— ここにあるのは計算した数だけである。
      </p>
    </>
  );
}
