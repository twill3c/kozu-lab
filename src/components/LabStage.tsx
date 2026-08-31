"use client";

// ④ 帰無仮説の実験室(F-12 / F-13 / SPEC §4・§8)。
//
// **このアプリの主張はここにしかない。**
// 「構図線を見つける」のではなく「構図線がいかに容易に見つかってしまうかを測る」。
//
// 並べるもの:
//   1. 分割比 t の走査曲線 —— 三分割も黄金比も、この曲線の上のただの一点である
//   2. **謳われた比に突起があるか** —— なだらかな傾向を引いてから見る。ここが結論である
//   3. 対照群 7 つの箱ひげ
//   4. 実作品とその破壊版(対応あり)—— 鏡像は効かないはずで、実際に効かない
//   5. 自由度の会計 —— 調整を許すほどスコアは上がる。**対照群の方が大きく上がる**

import { useMemo, useState } from "react";
import {
  contrast,
  dfLadder,
  groupSummaries,
  GROUP_LABEL,
  pairedContrast,
  ratioVerdicts,
  scanSummary,
  type ScoreFile,
} from "@/core/experiment";
import { GRID_KINDS } from "@/core/grids";
import { layerStyle } from "@/core/overlay";
import scores from "@/data/scores.json";

const FILE = scores as unknown as ScoreFile;

const W = 860;
const H = 300;

/** 走査曲線の描画。t を横軸、z を縦軸に取る */
function ScanChart({ orientation }: { orientation: "V" | "H" }) {
  const s = useMemo(() => scanSummary(FILE, orientation), [orientation]);
  const obj = layerStyle("objective");
  const norm = layerStyle("normative");

  const zAll = [...s.observed, ...s.lo, ...s.hi];
  const zMin = Math.min(...zAll) - 0.1;
  const zMax = Math.max(...zAll) + 0.1;
  const x = (t: number) => ((t - s.ts[0]) / (s.ts[s.ts.length - 1] - s.ts[0])) * (W - 60) + 45;
  const y = (z: number) => H - 30 - ((z - zMin) / (zMax - zMin)) * (H - 55);

  const bandPath =
    s.ts.map((t, i) => `${i ? "L" : "M"}${x(t)},${y(s.hi[i])}`).join(" ") +
    " " +
    [...s.ts].reverse().map((t, i) => `L${x(t)},${y(s.lo[s.ts.length - 1 - i])}`).join(" ") +
    " Z";
  const line = s.ts.map((t, i) => `${i ? "L" : "M"}${x(t)},${y(s.observed[i])}`).join(" ");

  /** 目盛りに置く比。**規範層である**ことを破線で示す */
  const marks = [
    { t: 1 / 3, label: "1/3" },
    { t: 2 / 3, label: "2/3" },
    { t: 1 - 1 / 1.618033988749895, label: "0.382" },
    { t: 1 / 1.618033988749895, label: "0.618" },
    { t: 1 - 1 / Math.SQRT2, label: "√2" },
  ];

  return (
    <div className="stage">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="分割比の走査曲線">
        <path d={bandPath} fill={norm.stroke} opacity={0.16} />
        {marks.map((m) => (
          <g key={m.label}>
            <line
              x1={x(m.t)}
              y1={18}
              x2={x(m.t)}
              y2={H - 30}
              stroke={norm.stroke}
              strokeWidth={norm.strokeWidth}
              strokeDasharray={norm.strokeDasharray}
              opacity={norm.opacity}
            />
            <text x={x(m.t)} y={14} fontSize={10} textAnchor="middle" fill={norm.stroke}>
              {m.label}
            </text>
          </g>
        ))}
        <line x1={45} y1={y(0)} x2={W - 15} y2={y(0)} stroke="currentColor" strokeWidth={0.5} opacity={0.4} />
        <path d={line} fill="none" stroke={obj.stroke} strokeWidth={obj.strokeWidth + 0.4} />
        {s.outside.map((o) => (
          <circle key={o.t} cx={x(o.t)} cy={y(o.z)} r={2.5} fill={obj.stroke} />
        ))}
        <text x={6} y={y(0) + 3} fontSize={10} fill="currentColor" opacity={0.6}>
          z=0
        </text>
        <text x={45} y={H - 12} fontSize={10} fill="currentColor" opacity={0.6}>
          t={s.ts[0].toFixed(2)}
        </text>
        <text x={W - 15} y={H - 12} fontSize={10} textAnchor="end" fill="currentColor" opacity={0.6}>
          t={s.ts[s.ts.length - 1].toFixed(2)}
        </text>
      </svg>
    </div>
  );
}

/** 箱ひげ図 */
function BoxPlot({ kind }: { kind: string }) {
  const rows = useMemo(() => groupSummaries(FILE, kind).filter((r) => r.n > 0), [kind]);
  const obj = layerStyle("objective");
  const all = rows.flatMap((r) => [r.min, r.max]);
  const lo = Math.min(...all) - 0.3;
  const hi = Math.max(...all) + 0.3;
  const bw = 76;
  const width = rows.length * bw + 60;
  const x = (i: number) => 50 + i * bw + bw / 2;
  const y = (z: number) => 250 - ((z - lo) / (hi - lo)) * 210;

  return (
    <div className="stage">
      <svg viewBox={`0 0 ${width} 290`} role="img" aria-label="対照群の箱ひげ図">
        <line x1={40} y1={y(0)} x2={width - 10} y2={y(0)} stroke="currentColor" strokeWidth={0.5} opacity={0.4} />
        <text x={6} y={y(0) + 3} fontSize={10} fill="currentColor" opacity={0.6}>
          z=0
        </text>
        {rows.map((r, i) => (
          <g key={r.group}>
            <line x1={x(i)} y1={y(r.min)} x2={x(i)} y2={y(r.max)} stroke={obj.stroke} strokeWidth={1} opacity={0.5} />
            <rect
              x={x(i) - 16}
              y={y(r.q3)}
              width={32}
              height={Math.max(1, y(r.q1) - y(r.q3))}
              fill={obj.stroke}
              opacity={0.18}
              stroke={obj.stroke}
              strokeWidth={1}
            />
            <line x1={x(i) - 16} y1={y(r.median)} x2={x(i) + 16} y2={y(r.median)} stroke={obj.stroke} strokeWidth={2} />
            <text x={x(i)} y={268} fontSize={9} textAnchor="middle" fill="currentColor" opacity={0.75}>
              {r.group}
            </text>
            <text x={x(i)} y={280} fontSize={8} textAnchor="middle" fill="currentColor" opacity={0.5}>
              n={r.n}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

export default function LabStage() {
  const [kind, setKind] = useState<string>("thirds");
  const scanV = useMemo(() => scanSummary(FILE, "V"), []);
  const scanH = useMemo(() => scanSummary(FILE, "H"), []);
  const summaries = useMemo(() => groupSummaries(FILE, kind), [kind]);
  const ladder = useMemo(() => dfLadder(FILE, kind === "golden" ? "golden" : "thirds"), [kind]);
  const paired = useMemo(
    () => (["C-trim", "C-rotate", "C-mirror"] as const).map((g) => pairedContrast(FILE, kind, g)),
    [kind],
  );
  const vsControls = useMemo(
    () => (["P", "D", "E"] as const).map((g) => contrast(FILE, kind, "A", g)),
    [kind],
  );

  return (
    <>
      <h2>① 分割比 t の走査曲線</h2>
      <p className="note">
        縦線を x = t に置いたときの z を、t = 0.05 から 0.95 まで 0.005 刻みで測った実作品 200 件の平均。
        帯は **順列帰無**(各作品の曲線の t ラベルを入れ替えて平均したもの)の 95 % 範囲。
        <strong>三分割も黄金比も、この曲線の上のただの一点である</strong> ——
        破線の目盛りは「あとから重ねた」ものであって、曲線はそれを知らない。
      </p>
      <ScanChart orientation="V" />
      <p className="note">
        縦線: 帯の外に出た t は <strong>{scanV.outside.length} 点</strong>
        {scanV.outside.length
          ? `(${scanV.outside.slice(0, 8).map((o) => `${o.t.toFixed(3)}${o.side}`).join(" ")}${scanV.outside.length > 8 ? " …" : ""})`
          : " —— どの比も特別ではない"}
      </p>
      <ScanChart orientation="H" />
      <p className="note">
        横線: 帯の外に出た t は <strong>{scanH.outside.length} 点</strong>
        {scanH.outside.length
          ? `(${scanH.outside.slice(0, 8).map((o) => `${o.t.toFixed(3)}${o.side}`).join(" ")}${scanH.outside.length > 8 ? " …" : ""})`
          : " —— どの比も特別ではない"}
      </p>

      <h2>② 謳われた比に、突起はあるか</h2>
      <p className="note">
        ①の曲線は<strong>中央に頂点を持つなだらかな単峰</strong>だった —— 画面の中央にエッジが集まるという、
        比とは無関係な構造である。そこでなだらかな傾向を引き、
        <strong>謳われた比の位置に局所的な突起があるか</strong>を見る。
        ★ が付いたものだけが「順列帰無の 95 % 帯を出た」= 偶然では説明しにくい。
      </p>
      {(["V", "H"] as const).map((o) => {
        const r = ratioVerdicts(FILE, o);
        return (
          <table key={o}>
            <thead>
              <tr>
                <th>{o === "V" ? "縦線" : "横線"}</th>
                <th className="num">t</th>
                <th className="num">残差</th>
                <th className="num">帯</th>
                <th>判定</th>
              </tr>
            </thead>
            <tbody>
              {r.verdicts.map((v) => (
                <tr key={v.name}>
                  <th>{v.name}</th>
                  <td className="num">{v.t.toFixed(3)}</td>
                  <td className="num">
                    {v.residual >= 0 ? "+" : ""}
                    {v.residual.toFixed(3)}
                  </td>
                  <td className="num">
                    [{v.lo.toFixed(3)}, {v.hi.toFixed(3)}]
                  </td>
                  <td className="note">{v.outside ? "★ 帯の外" : "帯の中"}</td>
                </tr>
              ))}
              <tr>
                <th>曲線全体</th>
                <td className="num" colSpan={2}>
                  {r.outsideCount}/{r.ts.length} 点が帯の外
                </td>
                <td className="num">—</td>
                <td className="note">偶然なら 5 % = 約 {Math.round(r.ts.length * 0.05)} 点</td>
              </tr>
            </tbody>
          </table>
        );
      })}

      <h2>③ 対照群くらべ</h2>
      <div className="controls">
        <div className="control">
          <label htmlFor="kind">重ねる格子</label>
          <select id="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
            {GRID_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </div>
      </div>
      <BoxPlot kind={kind} />
      <table>
        <thead>
          <tr>
            <th>群</th>
            <th className="num">n</th>
            <th className="num">中央値 z</th>
            <th className="num">平均 z</th>
            <th>中身</th>
          </tr>
        </thead>
        <tbody>
          {summaries.map((s) => (
            <tr key={s.group}>
              <th>{s.group}</th>
              <td className="num">{s.n}</td>
              <td className="num">{Number.isFinite(s.median) ? s.median.toFixed(2) : "—"}</td>
              <td className="num">{Number.isFinite(s.mean) ? s.mean.toFixed(2) : "—"}</td>
              <td className="note">{GROUP_LABEL[s.group]}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>④ 実作品とその破壊版(対応あり)</h2>
      <p className="note">
        同じ絵をトリム・回転・鏡像で壊したもの。<strong>画像統計はほぼ保たれ、格子との関係だけが崩れる</strong> ——
        ここで差が出なければ、このスコアは構図を測っていない。
      </p>
      <table>
        <thead>
          <tr>
            <th>対比</th>
            <th className="num">対の数</th>
            <th className="num">平均差</th>
            <th className="num">t</th>
            <th className="num">Cohen&apos;s d</th>
            <th className="num">Cliff&apos;s δ</th>
          </tr>
        </thead>
        <tbody>
          {paired.map((p) => (
            <tr key={p.b}>
              <th>A − {p.b}</th>
              <td className="num">{p.pairs}</td>
              <td className="num">{p.meanDiff.toFixed(3)}</td>
              <td className="num">{Number.isFinite(p.t) ? p.t.toFixed(2) : "—"}</td>
              <td className="num">{Number.isFinite(p.d) ? p.d.toFixed(3) : "—"}</td>
              <td className="num">{p.delta.toFixed(3)}</td>
            </tr>
          ))}
          {vsControls.map((c) => (
            <tr key={c.b}>
              <th>A − {c.b}</th>
              <td className="num">{c.n}</td>
              <td className="num">{c.meanDiff.toFixed(3)}</td>
              <td className="num">—</td>
              <td className="num">{c.d.toFixed(3)}</td>
              <td className="num">{c.delta.toFixed(3)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>⑤ 自由度の会計</h2>
      <p className="note">
        格子に調整を許すほどスコアは上がる。M0 は固定、M1 は拡大縮小、M3 は + 平行移動、M5 は + 回転と鏡像。
        <strong>上がること自体は当たり前で、見るべきは「対照群でも同じだけ上がるか」である</strong> ——
        ネット上の黄金螺旋図は M5 で当てながら M0 の顔をしている。
      </p>
      <table>
        <thead>
          <tr>
            <th>群</th>
            <th className="num">M0</th>
            <th className="num">M1</th>
            <th className="num">M3</th>
            <th className="num">M5</th>
            <th className="num">M5 − M0</th>
          </tr>
        </thead>
        <tbody>
          {ladder
            .filter((r) => r.n > 0)
            .map((r) => (
              <tr key={r.group}>
                <th>{r.group}</th>
                {r.steps.map((v, i) => (
                  <td key={i} className="num">
                    {Number.isFinite(v) ? v.toFixed(2) : "—"}
                  </td>
                ))}
                <td className="num">
                  <strong>{Number.isFinite(r.steps[3]) ? (r.steps[3] - r.steps[0]).toFixed(2) : "—"}</strong>
                </td>
              </tr>
            ))}
        </tbody>
      </table>

      <p className="note">
        帰無は {FILE.trials.toLocaleString()} 枚・シード {FILE.seed}。実作品は Met European Paintings の
        パブリックドメイン絵画から層化抽出した 200 件で、抽出規則は設計図に刻んである。
        <strong>画像は配っていない</strong> —— ここにあるのは、そこから計算した数だけである。
      </p>
    </>
  );
}
