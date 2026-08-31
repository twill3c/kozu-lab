import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import {
  byGroup,
  contrast,
  dfLadder,
  groupOf,
  groupSummaries,
  GROUP_IDS,
  objectIdOf,
  pairedContrast,
  scanSummary,
  summarize,
  ratioVerdicts,
  detrend,
  type ScoreFile,
} from "@/core/experiment";

// 期待値の出所(HC-016)
// ------------------------------------------------------------------
// 群の分け方は **鍵の接頭辞** で決まる(判断が入らない)。
// 数の期待値は **事前計算の実測**(data/scores/works.json)。
// **件数を定数で書かない** —— 集合の一致・取りこぼしの不在という不変量で書く。
//
// G-09 の N ≥ 175 は SPEC §8.1 の宣言値。
// G-10 は A 群とその破壊版の **対応あり** の対比 —— 対応が取れない作品は落とし、
// **黙って別の作品と組ませない**。

const FILE = "data/scores/works.json";

describe("群の分け方に判断が入らない", () => {
  it("鍵の接頭辞だけで決まる", () => {
    expect(groupOf("A-435581")).toBe("A");
    expect(groupOf("C-trim-435581")).toBe("C-trim");
    expect(groupOf("C-rotate-435581")).toBe("C-rotate");
    expect(groupOf("C-mirror-435581")).toBe("C-mirror");
    expect(groupOf("P-0")).toBe("P");
    expect(groupOf("D-12")).toBe("D");
    expect(groupOf("E-7")).toBe("E");
    expect(groupOf("なにか")).toBeNull();
  });

  it("A 群と C 群の対応は objectID で取る", () => {
    expect(objectIdOf("A-435581")).toBe("435581");
    expect(objectIdOf("C-trim-435581")).toBe("435581");
    expect(objectIdOf("P-3")).toBeNull();
  });

  it("群は宣言した 7 つ", () => {
    expect(GROUP_IDS).toEqual(["A", "C-trim", "C-rotate", "C-mirror", "P", "D", "E"]);
  });
});

describe("要約統計の検算(解析解)", () => {
  it("中央値・四分位は既知の列で手計算と一致する", () => {
    const s = summarize("A", [1, 2, 3, 4, 5]);
    expect(s.median).toBe(3);
    expect(s.q1).toBe(2);
    expect(s.q3).toBe(4);
    expect(s.min).toBe(1);
    expect(s.max).toBe(5);
    expect(s.mean).toBe(3);
  });
});

describe("F-13 / G-09 / G-10 事前計算の結果を読む", () => {
  it("スコアのファイルが実在する", () => {
    expect(
      existsSync(FILE),
      `${FILE} が無い。npx tsx scripts/build-points.ts → build-grids.ts → cargo run --release --bin score_all`,
    ).toBe(true);
  });

  const file = (): ScoreFile => JSON.parse(readFileSync(FILE, "utf8"));

  it("帰無の枚数・シード・走査の刻みが記録されている", () => {
    const f = file();
    expect(f.trials).toBeGreaterThanOrEqual(1000);
    expect(f.seed).toBe(20260831);
    expect(f.tMin).toBe(0.05);
    expect(f.tMax).toBe(0.95);
    expect(f.tStep).toBe(0.005);
    expect(f.kinds.length).toBe(9);
  });

  it("**取りこぼしが無い** —— 7 群すべてが埋まり、A 群と破壊版 3 種の数が揃う", () => {
    const g = byGroup(file());
    for (const id of GROUP_IDS) {
      expect(g.get(id)!.length, `${id} 群が空`).toBeGreaterThan(0);
    }
    const a = g.get("A")!.length;
    for (const k of ["C-trim", "C-rotate", "C-mirror"] as const) {
      expect(g.get(k)!.length, `${k} が A 群(${a} 件)と揃っていない`).toBe(a);
    }
  });

  it("G-09 —— 各群が N ≥ 175 を満たす", () => {
    const g = byGroup(file());
    for (const id of GROUP_IDS) {
      expect(g.get(id)!.length, `${id} 群が検定力を満たさない`).toBeGreaterThanOrEqual(175);
    }
  });

  it("走査曲線が 181 点で、全作品に入っている", () => {
    const f = file();
    const n = Math.round((f.tMax - f.tMin) / f.tStep) + 1;
    for (const w of f.works) {
      expect(w.scanV.length, `${w.key} の縦走査`).toBe(n);
      expect(w.scanH.length, `${w.key} の横走査`).toBe(n);
    }
  });

  it("**G-08 が実データでも成り立つ** —— P 群の三分割 z が A 群より高い", () => {
    const c = contrast(file(), "thirds", "P", "A");
    console.log(`G-08(実データ)P − A の三分割 z: 平均差 ${c.meanDiff.toFixed(2)} / d ${c.d.toFixed(2)} / δ ${c.delta.toFixed(2)}`);
    expect(c.meanDiff).toBeGreaterThan(0);
    expect(c.d).toBeGreaterThan(1);
  });

  it("G-10 —— A 群と破壊版の対応が全件取れる(黙って別の作品と組ませない)", () => {
    const f = file();
    const a = byGroup(f).get("A")!.length;
    for (const k of ["C-trim", "C-rotate", "C-mirror"] as const) {
      const p = pairedContrast(f, "thirds", k);
      expect(p.pairs, `${k} の対応が欠けている`).toBe(a);
    }
  });

  it("G-10 —— 対応ありの対比を記録する(閾値なし。数を残す)", () => {
    const f = file();
    const rows: string[] = [];
    for (const k of ["C-trim", "C-rotate", "C-mirror"] as const) {
      const p = pairedContrast(f, "thirds", k);
      rows.push(`A−${k}: 平均差 ${p.meanDiff.toFixed(3)} t ${p.t.toFixed(2)} d ${p.d.toFixed(3)} δ ${p.delta.toFixed(3)}`);
    }
    console.log("G-10 " + rows.join(" | "));
    expect(rows.length).toBe(3);
  });

  it("自由度の会計が単調に上がる(M0 ≤ M1 ≤ M3 ≤ M5)", () => {
    for (const row of dfLadder(file(), "thirds")) {
      if (row.n === 0) continue;
      for (let i = 1; i < 4; i++) {
        expect(row.steps[i], `${row.group} の M${i} が前段より低い`).toBeGreaterThanOrEqual(row.steps[i - 1] - 1e-9);
      }
    }
  });

  it("**自由度の上昇を対照群でも測っている** —— 全群で M5 − M0 が出る", () => {
    const rows = dfLadder(file(), "thirds").filter((r) => r.n > 0);
    expect(rows.length).toBe(GROUP_IDS.length);
    console.log(
      "自由度の会計(三分割・M5 − M0): " +
        rows.map((r) => `${r.group} ${(r.steps[3] - r.steps[0]).toFixed(2)}`).join(" / "),
    );
  });

  it("G-目玉1 —— 走査曲線が帯を出るかを記録する(閾値なし。どちらでも成果)", () => {
    const f = file();
    for (const o of ["V", "H"] as const) {
      const s = scanSummary(f, o);
      expect(s.ts.length).toBe(s.observed.length);
      const ts = s.outside.map((x) => x.t.toFixed(3));
      console.log(
        `G-目玉1(${o})帯の外 ${s.outside.length}/${s.ts.length} 点` +
          (ts.length ? ` — ${ts.slice(0, 12).join(" ")}${ts.length > 12 ? " …" : ""}` : " — どの比も特別ではない"),
      );
    }
  });

  it("格子 9 種すべてについて群の要約が出る", () => {
    const f = file();
    for (const k of f.kinds) {
      const s = groupSummaries(f, k);
      expect(s.filter((r) => r.n > 0).length, `${k} の群が埋まっていない`).toBe(GROUP_IDS.length);
    }
  });
});

describe("G-目玉1 の本体 —— 謳われた比に突起があるか", () => {
  const file = (): ScoreFile => JSON.parse(readFileSync(FILE, "utf8"));

  it("なだらかな傾向を引いてから、比の位置を見る(閾値なし。記録する)", () => {
    const f = file();
    for (const o of ["V", "H"] as const) {
      const r = ratioVerdicts(f, o);
      console.log(
        `G-目玉1 本体(${o})帯の外 ${r.outsideCount}/${r.ts.length} 点 —— ` +
          r.verdicts.map((v) => `${v.name} ${v.residual >= 0 ? "+" : ""}${v.residual.toFixed(3)}${v.outside ? "★" : ""}`).join(" / "),
      );
      expect(r.verdicts.length).toBe(7);
    }
  });

  it("detrend は定数を 0 にし、局所の突起を残す(解析解)", () => {
    const flat = new Array(61).fill(3);
    for (const v of detrend(flat, 21)) expect(v).toBeCloseTo(0, 10);
    const bump = new Array(61).fill(0);
    bump[30] = 1;
    const d = detrend(bump, 21);
    expect(d[30]).toBeGreaterThan(0.9); // 突起は残る
    expect(Math.abs(d[0])).toBeLessThan(0.06); // 遠くはほぼ 0
  });
});
