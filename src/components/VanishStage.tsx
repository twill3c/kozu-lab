"use client";

// ② 消失点(F-11 / SPEC §7)。客観層。
//
// **破綻することが情報である。**平行投影・浮世絵・キュビスムでは消失点が定義できない。
// そこを有限の点で埋めず、「無限遠」として返す。求まった場合も、
// **どれだけ当てにならないか(1σ)を数で添える** —— L3 の実測で、
// 推定器は見つけたものの申告はおおむね正しいが、2 割弱を見つけ損なうと分かっている
// (検出率 81.3 % / 被覆率 96.9 %、別シードで 82.5 % / 92.4 % — SPEC §11.5)。

import { useMemo, useRef, useState } from "react";
import { DEFAULT_DETECT, detectLines } from "@/core/hough";
import type { RasterImage } from "@/core/image";
import { layerStyle } from "@/core/overlay";
import { makeCamera, renderAffineCheckerboard, renderFloorCheckerboard } from "@/core/perspective";
import { describeVanishing, estimateVanishingPoints, VANISH_DEFAULTS } from "@/core/vanish";

const W = 560;
const H = 380;

type SceneKind = "perspective-wide" | "perspective-narrow" | "affine";

const SCENES: { id: SceneKind; label: string; note: string }[] = [
  {
    id: "perspective-wide",
    label: "透視図(線束が広い)",
    note: "消失点が画面の近くにあり、線束の広がりも大きい。よく定まる",
  },
  {
    id: "perspective-narrow",
    label: "透視図(線束が細い)",
    note: "消失点が遠く、線束はほぼ平行。**位置は原理的に定まらない** —— 申告される 1σ が跳ね上がる",
  },
  {
    id: "affine",
    label: "平行投影",
    note: "消失点が無限遠にある。**有限の点を返してはならない**",
  },
];

function render(kind: SceneKind): RasterImage {
  if (kind === "affine") {
    return renderAffineCheckerboard({ width: W, height: H, angleADeg: 18, angleBDeg: 104, cell: 26 });
  }
  const cam = makeCamera({
    width: W,
    height: H,
    focal: 700,
    yawDeg: kind === "perspective-wide" ? 45 : 10,
    pitchDeg: -28,
    height3d: 1.8,
  });
  return renderFloorCheckerboard(cam, { cell: 1.0 });
}

function toDataUrl(img: RasterImage): string {
  if (typeof document === "undefined") return "";
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext("2d");
  if (!ctx) return "";
  const id = ctx.createImageData(img.width, img.height);
  id.data.set(img.data);
  ctx.putImageData(id, 0, 0);
  return c.toDataURL("image/png");
}

/** 直線を画面の矩形で切る */
function clip(theta: number, rho: number): [number, number, number, number] | null {
  const ct = Math.cos(theta);
  const st = Math.sin(theta);
  const pts: { x: number; y: number }[] = [];
  const push = (x: number, y: number) => {
    if (Math.abs(x) <= W / 2 + 1e-6 && Math.abs(y) <= H / 2 + 1e-6) pts.push({ x, y });
  };
  if (Math.abs(st) > 1e-9) {
    push(-W / 2, (rho + (W / 2) * ct) / st);
    push(W / 2, (rho - (W / 2) * ct) / st);
  }
  if (Math.abs(ct) > 1e-9) {
    push((rho + (H / 2) * st) / ct, -H / 2);
    push((rho - (H / 2) * st) / ct, H / 2);
  }
  if (pts.length < 2) return null;
  const a = pts[0];
  let b = pts[1];
  for (const p of pts.slice(1)) {
    if (Math.hypot(p.x - a.x, p.y - a.y) > Math.hypot(b.x - a.x, b.y - a.y)) b = p;
  }
  return [a.x + W / 2, a.y + H / 2, b.x + W / 2, b.y + H / 2];
}

export default function VanishStage() {
  const [kind, setKind] = useState<SceneKind>("perspective-wide");
  const cache = useRef(new Map<string, string>());

  const img = useMemo(() => render(kind), [kind]);
  const lines = useMemo(() => detectLines(img, DEFAULT_DETECT), [img]);
  const vps = useMemo(() => estimateVanishingPoints(lines, W, H, VANISH_DEFAULTS), [lines]);

  if (!cache.current.has(kind)) cache.current.set(kind, toDataUrl(img));
  const url = cache.current.get(kind)!;

  const obj = layerStyle("objective");
  const scene = SCENES.find((s) => s.id === kind)!;
  const finite = vps.filter((v) => v.kind === "finite") as Extract<
    (typeof vps)[number],
    { kind: "finite" }
  >[];

  return (
    <>
      <div className="controls">
        <div className="control">
          <label htmlFor="scene">場面</label>
          <select id="scene" value={kind} onChange={(e) => setKind(e.target.value as SceneKind)}>
            {SCENES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="stage">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="検出直線と消失点">
          <image href={url} x={0} y={0} width={W} height={H} />
          <g stroke={obj.stroke} strokeWidth={obj.strokeWidth} opacity={0.6} fill="none">
            {lines.map((l, i) => {
              const seg = clip(l.theta, l.rho);
              return seg ? <line key={i} x1={seg[0]} y1={seg[1]} x2={seg[2]} y2={seg[3]} /> : null;
            })}
          </g>
          {finite.map((v, i) => {
            const cx = v.x + W / 2;
            const cy = v.y + H / 2;
            const inside = cx >= 0 && cx <= W && cy >= 0 && cy <= H;
            if (!inside) return null;
            const r = Math.min(120, Math.max(4, v.uncertaintyPx));
            return (
              <g key={`v${i}`}>
                {/* 不確かさの 1σ を円で出す —— 「ここだ」と言えない度合いを図でも見せる */}
                <circle cx={cx} cy={cy} r={r} fill="none" stroke={obj.stroke} strokeWidth={1} opacity={0.35} />
                <circle cx={cx} cy={cy} r={4} fill={obj.stroke} />
              </g>
            );
          })}
        </svg>
      </div>

      <p className="note">{scene.note}</p>

      <h2>推定した消失点</h2>
      <table>
        <tbody>
          {vps.length === 0 ? (
            <tr>
              <th>—</th>
              <td colSpan={2} className="note">
                材料不足。消失点を返さない(埋めない)
              </td>
            </tr>
          ) : (
            vps.map((v, i) => (
              <tr key={i}>
                <th>{v.kind === "finite" ? `消失点 ${i + 1}` : "無限遠"}</th>
                <td>{describeVanishing(v, W, H)}</td>
                <td className="note">
                  {v.kind === "infinite"
                    ? "平行なまま交わらない。有限の点で埋めていない"
                    : `整合角の平均 ${v.residual.toFixed(2)}°`}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <p className="note">
        検出直線 {lines.length} 本。**この推定器は合成画像に対してすら精度を保証できていない** ——
        シード生成 40 台の実測で、線束を見つけられたのは 81.3 %(別シードで 82.5 %)、
        見つけたものの誤差が申告 1σ の 3 倍に収まったのは 96.9 %(同 92.4 %)。
        精度の主張は三度立てて三度捨てた(設計図 §11.5)。**残した主張は「破綻を破綻として返す」だけ**である。
      </p>
    </>
  );
}
