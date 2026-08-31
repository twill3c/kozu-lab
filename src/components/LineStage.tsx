"use client";

// ① 線を見る + ③ 格子を重ねる。
//
// **この二つを別画面にしないことが設計上の要点である**(SPEC §7)。
// しきい値を下げれば線は増え、上げれば減る。「その絵の構図線」が分析者の選んだ
// しきい値の関数であることを、当てはまりスコアの動きとして同一視野に入れる。
//
// 線はすべて layerStyle を経由して描く —— 客観層は実線、規範層は破線(G-11 / T-014)。

import { useEffect, useMemo, useRef, useState } from "react";
import { canny, DEFAULT_CANNY } from "@/core/canny";
import { buildGrid, GRID_KINDS, type GridKind } from "@/core/grids";
import { DEFAULT_DETECT, houghTransform, extractPeaks } from "@/core/hough";
import type { Line, Point, RasterImage } from "@/core/image";
import { drawLines } from "@/core/synth";
import { layerStyle, SUBJECT_LINE } from "@/core/overlay";
import { nullDistribution, rawScore, zScore, zUncertainty } from "@/core/score";

const W = 900;
const H = 600;

/** 検品用の合成画像。実作品は L1 の射程外(取得器は F-07 で用意済み) */
function sampleImage(): RasterImage {
  const support = (deg: number) => {
    const t = (deg * Math.PI) / 180;
    return (W / 2) * Math.abs(Math.cos(t)) + (H / 2) * Math.abs(Math.sin(t));
  };
  const l = (deg: number, f: number): Line => ({ theta: (deg * Math.PI) / 180, rho: f * support(deg) });
  return drawLines({
    width: W,
    height: H,
    mode: "step",
    lines: [l(90, -0.32), l(0, 0.34), l(28, 0.55), l(152, -0.5), l(0, -0.66)],
  });
}

/** 直線を画面の矩形で切って線分にする */
function clip(line: Line): [number, number, number, number] | null {
  const ct = Math.cos(line.theta);
  const st = Math.sin(line.theta);
  const pts: Point[] = [];
  const push = (x: number, y: number) => {
    if (Math.abs(x) <= W / 2 + 1e-6 && Math.abs(y) <= H / 2 + 1e-6) pts.push({ x, y });
  };
  if (Math.abs(st) > 1e-9) {
    push(-W / 2, (line.rho - -(W / 2) * ct) / st);
    push(W / 2, (line.rho - (W / 2) * ct) / st);
  }
  if (Math.abs(ct) > 1e-9) {
    push((line.rho - -(H / 2) * st) / ct, -H / 2);
    push((line.rho - (H / 2) * st) / ct, H / 2);
  }
  if (pts.length < 2) return null;
  const a = pts[0];
  let b = pts[1];
  for (const p of pts.slice(1)) {
    if (Math.hypot(p.x - a.x, p.y - a.y) > Math.hypot(b.x - a.x, b.y - a.y)) b = p;
  }
  return [a.x + W / 2, a.y + H / 2, b.x + W / 2, b.y + H / 2];
}

function angleClass(theta: number): "水平" | "垂直" | "対角" {
  const deg = (theta * 180) / Math.PI;
  if (deg < 15 || deg >= 165) return "垂直";
  if (deg >= 75 && deg < 105) return "水平";
  return "対角";
}

const CLASS_HUE = { 垂直: "#c8321e", 水平: "#1e6fc8", 対角: "#b07d18" } as const;

export default function LineStage() {
  const img = useMemo(sampleImage, []);
  const [voteRatio, setVoteRatio] = useState(DEFAULT_DETECT.voteRatio);
  const [sigmaPct, setSigmaPct] = useState(1.0);
  const [gridKind, setGridKind] = useState<GridKind>("thirds");
  const [nullTrials, setNullTrials] = useState(2000);
  const bgRef = useRef<string>("");

  // 背景画像は一度だけ data URI にする(画像は配らない。ここは合成物である)
  if (!bgRef.current && typeof document !== "undefined") {
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext("2d");
    if (ctx) {
      // ImageData を直接組まず createImageData に写す —— Uint8ClampedArray の
      // 裏付けバッファ型(ArrayBuffer / SharedArrayBuffer)の差で型検査が落ちるため
      const id = ctx.createImageData(img.width, img.height);
      id.data.set(img.data);
      ctx.putImageData(id, 0, 0);
      bgRef.current = c.toDataURL("image/png");
    }
  }

  // エッジと投票はしきい値に依存しないので一度だけ
  const { hough, edgePoints } = useMemo(() => {
    const e = canny(img, DEFAULT_CANNY);
    const h = houghTransform(e, img.width, img.height, DEFAULT_DETECT);
    const pts: Point[] = [];
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        if (e[y * img.width + x]) pts.push({ x: x - img.width / 2, y: y - img.height / 2 });
      }
    }
    return { hough: h, edgePoints: pts };
  }, [img]);

  const lines = useMemo(
    () => extractPeaks(hough, { ...DEFAULT_DETECT, voteRatio }),
    [hough, voteRatio],
  );

  const grid = useMemo(() => buildGrid(gridKind, W, H), [gridKind]);
  const sigma = (Math.min(W, H) * sigmaPct) / 100;

  // 当てはまりスコアは **検出されたエッジ点** に対して測る。
  // しきい値を動かすと lines は変わるが edgePoints は変わらない ——
  // 変わるのは「どの線を構図線と呼ぶか」であって、絵ではない。
  const [score, setScore] = useState<{ raw: number; z: number; err: number } | null>(null);
  useEffect(() => {
    const sub = edgePoints.filter((_, i) => i % 4 === 0); // 帰無を回すので間引く
    const dist = nullDistribution(sub, grid, W, H, { sigma, seed: 20260831, trials: nullTrials });
    const z = zScore(sub, grid, dist, sigma);
    setScore({ raw: rawScore(sub, grid, sigma), z, err: zUncertainty(z, nullTrials) });
  }, [edgePoints, grid, sigma, nullTrials]);

  const obj = layerStyle("objective");
  const norm = layerStyle("normative");
  const counts = { 水平: 0, 垂直: 0, 対角: 0 };
  for (const l of lines) counts[angleClass(l.theta)]++;

  return (
    <>
      <p className="subject">{SUBJECT_LINE}</p>

      <div className="controls">
        <div className="control">
          <label htmlFor="vote">
            検出しきい値(最大票数比) <span className="val">{voteRatio.toFixed(2)}</span>
          </label>
          <input
            id="vote"
            type="range"
            min={0.05}
            max={0.9}
            step={0.01}
            value={voteRatio}
            onChange={(e) => setVoteRatio(Number(e.target.value))}
          />
        </div>
        <div className="control">
          <label htmlFor="sigma">
            スコアの許容幅 σ(短辺比) <span className="val">{sigmaPct.toFixed(2)} %</span>
          </label>
          <input
            id="sigma"
            type="range"
            min={0.2}
            max={3}
            step={0.05}
            value={sigmaPct}
            onChange={(e) => setSigmaPct(Number(e.target.value))}
          />
        </div>
        <div className="control">
          <label htmlFor="grid">重ねる格子(規範層)</label>
          <select id="grid" value={gridKind} onChange={(e) => setGridKind(e.target.value as GridKind)}>
            {GRID_KINDS.map((k) => (
              <option key={k} value={k}>
                {buildGrid(k, W, H).name}
              </option>
            ))}
          </select>
        </div>
        <div className="control">
          <label htmlFor="trials">
            帰無の枚数 <span className="val">{nullTrials.toLocaleString()}</span>
          </label>
          <input
            id="trials"
            type="range"
            min={200}
            max={16000}
            step={200}
            value={nullTrials}
            onChange={(e) => setNullTrials(Number(e.target.value))}
          />
        </div>
      </div>

      <div className="stage">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="検出直線と重ねた格子">
          {bgRef.current ? <image href={bgRef.current} x={0} y={0} width={W} height={H} /> : null}

          {/* 規範層 —— 破線。絵の中に描かれてはいない */}
          <g
            stroke={norm.stroke}
            strokeWidth={norm.strokeWidth}
            strokeDasharray={norm.strokeDasharray}
            opacity={norm.opacity}
            fill="none"
          >
            {grid.lines.map((l, i) => {
              const seg = clip(l);
              return seg ? <line key={`g${i}`} x1={seg[0]} y1={seg[1]} x2={seg[2]} y2={seg[3]} /> : null;
            })}
          </g>
          <g fill={norm.stroke} opacity={norm.opacity}>
            {grid.points.map((p, i) => (
              <circle key={`p${i}`} cx={p.x + W / 2} cy={p.y + H / 2} r={3} />
            ))}
          </g>

          {/* 客観層 —— 実線。画素から測れたもの */}
          <g strokeWidth={obj.strokeWidth} opacity={obj.opacity} fill="none">
            {lines.map((l, i) => {
              const seg = clip(l);
              if (!seg) return null;
              return (
                <line
                  key={`l${i}`}
                  x1={seg[0]}
                  y1={seg[1]}
                  x2={seg[2]}
                  y2={seg[3]}
                  stroke={CLASS_HUE[angleClass(l.theta)]}
                />
              );
            })}
          </g>
        </svg>
      </div>

      <div className="legend">
        <span>
          <span className="swatch" style={{ borderTopColor: obj.stroke }} />
          {obj.legend}(実線)—— 画素から測れたもの
        </span>
        <span>
          <span
            className="swatch"
            style={{ borderTopColor: norm.stroke, borderTopStyle: "dashed" }}
          />
          {norm.legend}(破線)—— 見る側が事後に重ねたもの
        </span>
      </div>

      <h2>しきい値を動かすと何が変わるか</h2>
      <table>
        <tbody>
          <tr>
            <th>検出直線</th>
            <td className="num">{lines.length} 本</td>
            <td className="note">
              水平 {counts.水平} / 垂直 {counts.垂直} / 対角 {counts.対角}
            </td>
          </tr>
          <tr>
            <th>生スコア raw</th>
            <td className="num">{score ? score.raw.toFixed(4) : "…"}</td>
            <td className="note">格子線が多いほど必ず上がる。このままでは格子どうしを比べられない</td>
          </tr>
          <tr>
            <th>z(帰無比)</th>
            <td className="num">
              {score ? `${score.z.toFixed(2)} ± ${score.err.toFixed(2)}` : "…"}
            </td>
            <td className="note">
              同じ本数・同じ角度分布のランダム格子 {nullTrials.toLocaleString()} 枚に対する立ち位置。
              枚数を減らすと速く出るが粗くなる
            </td>
          </tr>
          <tr>
            <th>格子の線数</th>
            <td className="num">{grid.lineCount}</td>
            <td className="note">{grid.name} / 画面内の交点 {grid.points.length} 個</td>
          </tr>
        </tbody>
      </table>
      <p className="note">
        しきい値を下げれば線は増え、上げれば減る。**その絵の構図線**は分析者が選んだしきい値の関数である ——
        この表がその関数を数で見せている。σ を動かせば z も動く。どちらも既定値は宣言値にすぎない。
      </p>
    </>
  );
}
