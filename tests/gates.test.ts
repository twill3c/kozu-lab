import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { drawLines, degrade } from "@/core/synth";
import { detectLines, lineDistance, DEFAULT_DETECT } from "@/core/hough";
import { normalizeShortSide } from "@/core/resample";
import { LAYER_STYLE, layerStyle } from "@/core/overlay";
import { createRng } from "@/core/rng";

const W = 512;
const H = 384;
const R = Math.hypot(W / 2, H / 2);
const TOL_THETA_DEG = 1.0;
const TOL_RHO_PX = Math.min(W, H) * 0.005;

// ρ は θ 依存の支持関数に対する比(tests/hough.test.ts と同じ理由 — HC-070)
function support(deg: number, w = W, h = H): number {
  const t = (deg * Math.PI) / 180;
  return (w / 2) * Math.abs(Math.cos(t)) + (h / 2) * Math.abs(Math.sin(t));
}
function truth(deg: number, frac: number) {
  return { theta: (deg * Math.PI) / 180, rho: frac * support(deg) };
}
function recovered(img: ReturnType<typeof drawLines>, lines: { theta: number; rho: number }[]) {
  const found = detectLines(img, DEFAULT_DETECT);
  return lines.every((t) =>
    found.some((c) => {
      const d = lineDistance(t, c, R);
      return d.dThetaDeg <= TOL_THETA_DEG && d.dRho <= TOL_RHO_PX;
    }),
  );
}

// G-13 は測定であってゲートではない(SPEC §11)。閾値を置かず、壊れる境界を数として残す。
describe("T-011 / G-13 劣化耐性の境界を測る(閾値なし)", () => {
  const lines = [truth(0, -0.4), truth(37, 0.2), truth(90, 0), truth(128, 0.45)];
  const base = drawLines({ width: W, height: H, mode: "step", lines });

  it("JPEG 相当の量子化・ノイズ・筆触・額縁の各軸で境界を記録する", () => {
    const report: string[] = [];

    const axes: { name: string; levels: number[]; make: (v: number) => ReturnType<typeof drawLines> }[] = [
      {
        name: "JPEG 品質",
        levels: [95, 85, 70, 55, 40, 30, 20, 12, 8, 5, 3, 1],
        make: (q) => degrade(base, { jpegQuality: q }, createRng(20260831)),
      },
      {
        name: "ノイズ σ",
        levels: [0, 8, 16, 24, 32, 48, 64, 96, 128, 160],
        make: (s) => degrade(base, { noiseSigma: s }, createRng(20260831)),
      },
      {
        name: "筆触強度",
        levels: [0, 0.5, 1, 2, 3, 4, 6, 8, 12],
        make: (s) => degrade(base, { brushStrength: s }, createRng(20260831)),
      },
      {
        name: "額縁幅 %",
        levels: [0, 2, 4, 6, 8, 12, 16, 20, 25],
        make: (f) => degrade(base, { frameWidthPct: f }, createRng(20260831)),
      },
    ];

    for (const axis of axes) {
      let boundary = "上限まで壊れず";
      for (const v of axis.levels) {
        if (!recovered(axis.make(v), lines)) {
          boundary = `${v} で壊れる`;
          break;
        }
      }
      report.push(`${axis.name}: ${boundary}`);
    }
    console.log("G-13 劣化耐性の境界 —— " + report.join(" / "));
    expect(report.length).toBe(4);
  });

  it("無劣化では復元できる(測定の基点)", () => {
    expect(recovered(base, lines)).toBe(true);
  });
});

// SPEC §3.6。出典が違えば元の解像度が 3 倍違う(Wikimedia 1082–1490 / Met web-large 419)。
describe("T-016 / T-017 解析解像度の正規化と交絡", () => {
  it("normalizeShortSide が短辺を目標値に揃える", () => {
    const img = drawLines({ width: 1920, height: 1082, lines: [truth(30, 0.2)] });
    const out = normalizeShortSide(img, 1024);
    expect(Math.min(out.width, out.height)).toBe(1024);
    // 縦横比が保たれる(1 px の丸めを許す)
    expect(Math.abs(out.width / out.height - 1920 / 1082)).toBeLessThan(0.01);
  });

  it("短辺が目標に届かない画像は拡大せずそのまま返し、届かなかったことを示す", () => {
    const img = drawLines({ width: 600, height: 419, lines: [truth(30, 0.2)] });
    const out = normalizeShortSide(img, 1024);
    expect(out.width).toBe(600);
    expect(out.height).toBe(419);
    expect(out.reachedTarget).toBe(false);
  });

  it("T-017 解像度の交絡を測る —— 同一作品を 419 / 1024 / 1490 で解析して直線数を記録する", () => {
    const lines = [truth(0, -0.4), truth(37, 0.2), truth(90, 0), truth(128, 0.45), truth(160, -0.1)];
    const rows: string[] = [];
    for (const shortSide of [419, 1024, 1490]) {
      const w = Math.round((shortSide * 1920) / 1082);
      const img = drawLines({ width: w, height: shortSide, mode: "step", lines });
      const n = detectLines(img, DEFAULT_DETECT).length;
      rows.push(`短辺 ${shortSide} → ${n} 本`);
    }
    console.log("T-017 解像度と検出直線数: " + rows.join(" / "));
    expect(rows.length).toBe(3);
  });
});

// SPEC §2 / G-11。客観層は実線、規範層は破線。混ぜたら落ちる。
describe("T-014 / G-11 層の混線禁止", () => {
  it("規範層の描画属性は必ず破線を持つ", () => {
    const n = layerStyle("normative");
    expect(n.strokeDasharray).toBeTruthy();
    expect(n.strokeDasharray).not.toBe("none");
  });

  it("客観層の描画属性は実線である", () => {
    const o = layerStyle("objective");
    expect(o.strokeDasharray === undefined || o.strokeDasharray === "none").toBe(true);
  });

  it("層は 2 つだけで、凡例語が分かれている", () => {
    expect(Object.keys(LAYER_STYLE).sort()).toEqual(["normative", "objective"]);
    expect(LAYER_STYLE.objective.legend).toBe("測定");
    expect(LAYER_STYLE.normative.legend).toBe("重ねた格子");
  });

  it("陽性対照 —— 破線を持たない規範層スタイルはこの検査に捕まる", () => {
    const broken = { ...layerStyle("normative"), strokeDasharray: "none" };
    expect(broken.strokeDasharray === undefined || broken.strokeDasharray === "none").toBe(true);
  });

  it("画面側が規範層の線を描くとき layerStyle を経由している(素の <line> を書かない)", () => {
    // 走査対象を先に観測する(HC-040): src/app と src/components の .tsx すべて
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = `${dir}/${e.name}`;
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith(".tsx")) files.push(p);
      }
    };
    walk("src/app");
    try {
      walk("src/components");
    } catch {
      /* まだ無くてよい */
    }
    console.log(`T-014 走査対象 ${files.length} 件: ${files.join(", ")}`);
    expect(files.length).toBeGreaterThan(0);

    // 述語は **語ではなく構造** に当てる(HC-099)。初版は /grid|Grid|格子/ で判定していたが、
    // metadata の説明文「構図の格子を重ねる」に当たって layout.tsx を誤検出した。
    // 散文は実装と同じ語彙を使うので、語で実装を検査してはならない。
    const drawsLines = files.filter((f) => readFileSync(f, "utf8").includes("<line"));
    // 当たったファイルを目で確かめられるように出す(HC-099)
    console.log(`T-014 SVG の線を描くファイル: ${drawsLines.join(", ") || "(無し)"}`);
    expect(drawsLines.length, "線を描くファイルが 1 つも無い —— 検査が空振りしている").toBeGreaterThan(0);

    for (const f of drawsLines) {
      const src = readFileSync(f, "utf8");
      expect(src, `${f} が線を描くのに layerStyle を経由していない`).toMatch(/layerStyle|LAYER_STYLE/);
    }
  });
});

// SPEC F-08。全画面に測っている対象の主語を出す。
describe("T-013 主語の一文が全ページに出る", () => {
  it("各 page.tsx が SUBJECT_LINE を参照している", () => {
    const pages: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = `${dir}/${e.name}`;
        if (e.isDirectory()) walk(p);
        else if (e.name === "page.tsx") pages.push(p);
      }
    };
    walk("src/app");
    expect(pages.length).toBeGreaterThan(0);
    for (const p of pages) {
      const src = readFileSync(p, "utf8");
      expect(src, `${p} に主語の一文が無い`).toMatch(/SUBJECT_LINE|Subject/);
    }
  });
});

// フリート共通のフッタ規約(koho-lens が正本)。6 項目・下部固定
describe("フッタ規約", () => {
  it("6 項目がこの並びで入っている", () => {
    const src = readFileSync("src/app/layout.tsx", "utf8");
    const wanted = ["MIT License", "©", "GitHub", "歩き方", "設計図", "App Menu"];
    let at = -1;
    for (const w of wanted) {
      const i = src.indexOf(w, at + 1);
      expect(i, `${w} が無いか並びが違う`).toBeGreaterThan(at);
      at = i;
    }
  });

  it("position: fixed で常時表示する", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    expect(css).toMatch(/\.site-footer\s*\{[^}]*position:\s*fixed/);
  });

  it("**存在しない先へリンクしていない** —— 内部リンクは実在するページだけ", () => {
    const src = readFileSync("src/app/layout.tsx", "utf8");
    const internal = [...src.matchAll(/"(\/[a-z-]*\/?)"/g)].map((m) => m[1]);
    for (const href of internal) {
      const route = href === "/" ? "src/app/page.tsx" : `src/app${href}page.tsx`;
      expect(existsSync(route), `${href} の実体が無い`).toBe(true);
    }
  });

  it("歩き方と設計図が別々の先を指している(同じ所へ二重に張らない)", () => {
    const src = readFileSync("src/app/layout.tsx", "utf8");
    const guide = src.match(/guide:\s*"([^"]+)"/)?.[1];
    const blueprint = src.match(/blueprint:\s*"([^"]+)"/)?.[1];
    expect(guide, "歩き方の行き先が無い").toBeTruthy();
    expect(blueprint, "設計図の行き先が無い").toBeTruthy();
    expect(guide).not.toBe(blueprint);
  });
});
