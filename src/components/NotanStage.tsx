"use client";

// ⑤ ノタン —— 絵を明暗の面の構成として見る(F-09 / SPEC §7)。
//
// 三つを同じ視野に置く: 原画・明暗の面・左右反転。
// **左右反転は画家が構図を確かめるのに使ってきた古典的な手法**で、
// 見慣れた並びが崩れると偏りが見える、という経験則に基づく ——
// これは客観層の測定ではなく **見方の道具** である。だから明度重心(実線・測定)と
// 並べても、反転そのものは何も主張しない。
//
// しきい値は分析者が選ぶ。動かせば面の構成は変わる —— ① と同じ性格を持つ。

import { useMemo, useRef, useState } from "react";
import type { RasterImage } from "@/core/image";
import { luminanceCentroid, mirrorHorizontal, posterize, toneAreas, NOTAN_LEVELS, type NotanLevel } from "@/core/notan";
import { layerStyle } from "@/core/overlay";
import { drawLines } from "@/core/synth";

const W = 460;
const H = 320;

/** 検品用の合成画像。明暗の面がはっきり分かれる配置にしてある */
function sampleImage(): RasterImage {
  const support = (deg: number) => {
    const t = (deg * Math.PI) / 180;
    return (W / 2) * Math.abs(Math.cos(t)) + (H / 2) * Math.abs(Math.sin(t));
  };
  const l = (deg: number, f: number) => ({ theta: (deg * Math.PI) / 180, rho: f * support(deg) });
  return drawLines({
    width: W,
    height: H,
    mode: "step",
    lines: [l(90, -0.28), l(0, 0.42), l(24, 0.6)],
    background: 236,
    foreground: 54,
  });
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

const TONE_NAME: Record<number, string> = { 0: "暗", 128: "中", 255: "明" };

export default function NotanStage() {
  const img = useMemo(sampleImage, []);
  const [levels, setLevels] = useState<NotanLevel>(2);
  const [threshold, setThreshold] = useState(0.5);
  const [mirrored, setMirrored] = useState(true);
  const cache = useRef(new Map<string, string>());

  const quantized = useMemo(() => posterize(img, levels, threshold), [img, levels, threshold]);
  const shown = useMemo(() => (mirrored ? mirrorHorizontal(quantized) : quantized), [quantized, mirrored]);
  const areas = useMemo(() => toneAreas(img, levels, threshold), [img, levels, threshold]);
  const centroid = useMemo(() => luminanceCentroid(img), [img]);

  const url = (key: string, i: RasterImage) => {
    const k = `${key}:${levels}:${threshold}:${mirrored}`;
    if (!cache.current.has(k)) cache.current.set(k, toDataUrl(i));
    return cache.current.get(k)!;
  };

  const obj = layerStyle("objective");
  const tones = levels === 2 ? [0, 255] : [0, 128, 255];

  return (
    <>
      <div className="controls">
        <div className="control">
          <label htmlFor="levels">段数</label>
          <select
            id="levels"
            value={levels}
            onChange={(e) => setLevels(Number(e.target.value) as NotanLevel)}
          >
            {NOTAN_LEVELS.map((n) => (
              <option key={n} value={n}>
                {n} 値
              </option>
            ))}
          </select>
        </div>
        <div className="control">
          <label htmlFor="th">
            しきい値 <span className="val">{threshold.toFixed(2)}</span>
          </label>
          <input
            id="th"
            type="range"
            min={0.05}
            max={0.95}
            step={0.01}
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
          />
        </div>
        <div className="control">
          <label htmlFor="mir">並置</label>
          <select id="mir" value={mirrored ? "1" : "0"} onChange={(e) => setMirrored(e.target.value === "1")}>
            <option value="1">左右反転を並べる</option>
            <option value="0">反転しない</option>
          </select>
        </div>
      </div>

      <div className="pair">
        <figure className="stage">
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="原画と明度重心">
            <image href={url("src", img)} x={0} y={0} width={W} height={H} />
            {centroid ? (
              <g stroke={obj.stroke} strokeWidth={obj.strokeWidth} fill="none" opacity={obj.opacity}>
                <circle cx={centroid.x + W / 2} cy={centroid.y + H / 2} r={7} />
                <line
                  x1={centroid.x + W / 2 - 12}
                  y1={centroid.y + H / 2}
                  x2={centroid.x + W / 2 + 12}
                  y2={centroid.y + H / 2}
                />
                <line
                  x1={centroid.x + W / 2}
                  y1={centroid.y + H / 2 - 12}
                  x2={centroid.x + W / 2}
                  y2={centroid.y + H / 2 + 12}
                />
              </g>
            ) : null}
          </svg>
          <figcaption className="note">原画 + 明度重心({obj.legend})</figcaption>
        </figure>

        <figure className="stage">
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="明暗の面">
            <image href={url("q", shown)} x={0} y={0} width={W} height={H} />
          </svg>
          <figcaption className="note">
            {levels} 値の面{mirrored ? "(左右反転)" : ""}
          </figcaption>
        </figure>
      </div>

      <table>
        <tbody>
          <tr>
            <th>明度重心</th>
            <td className="num">
              {centroid ? `(${centroid.x.toFixed(1)}, ${centroid.y.toFixed(1)})` : "—"}
            </td>
            <td className="note">
              画面中心からのずれ(px)。総明度 0 の画像では返さない —— 「真っ黒な絵の重心は中心」という嘘をつかない
            </td>
          </tr>
          {tones.map((t, i) => (
            <tr key={t}>
              <th>{TONE_NAME[t]} の面積比</th>
              <td className="num">{areas[i] !== undefined ? `${(areas[i] * 100).toFixed(1)} %` : "—"}</td>
              <td className="note">{i === 0 ? "しきい値を動かせば面の構成は変わる。既定値は宣言値にすぎない" : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="note">
        「ノタン(濃淡)」は日本の画論の語で、20 世紀初頭に西洋のデザイン教育へ輸入された。
        左右反転は画家が構図を確かめるのに使ってきた手法で、**測定ではなく見方の道具**である ——
        反転そのものは何も主張しない。主張しているのは明度重心の位置だけで、それは実線で描いてある。
      </p>
    </>
  );
}
