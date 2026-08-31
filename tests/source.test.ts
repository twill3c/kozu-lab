import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  WIKIMEDIA_STANDARD_WIDTHS,
  TARGET_SHORT_SIDE,
  chooseWikimediaWidth,
  wikimediaThumbUrl,
  classifyFailure,
} from "@/core/imageSource";
import { createRng } from "@/core/rng";

// 期待値の出所(HC-016)
// ------------------------------------------------------------------
// 白名簿 11 幅の出所は **外部権威**:
//   https://www.mediawiki.org/wiki/Common_thumbnail_sizes(w.wiki/GHai の転送先)
//   $wgThumbnailSteps の Wikimedia 本番値 / phab:T414805。取得日 2026-08-31。
// あわせて **実測 2026-08-31**: 4 作品 × 26 幅 = 104 リクエストで、
//   標準 11 幅 44/44 が 200、非標準 15 幅 60/60 が 400。例外ゼロ(SPEC §3.2)。
//
// 4 作品の原寸も実測値(SPEC §3.2 の表):
//   最後の晩餐 5193×2926 / アテナイの学堂 3820×2964 /
//   グランド・ジャット島 30000×19970 / 神奈川沖浪裏 3859×2594

const MEASURED = [
  { name: "最後の晩餐", w: 5193, h: 2926 },
  { name: "アテナイの学堂", w: 3820, h: 2964 },
  { name: "グランド・ジャット島", w: 30000, h: 19970 },
  { name: "神奈川沖浪裏", w: 3859, h: 2594 },
];

describe("白名簿そのもの(SPEC §3.2)", () => {
  it("11 幅・昇順・重複なし", () => {
    expect(WIKIMEDIA_STANDARD_WIDTHS).toEqual([20, 40, 60, 120, 250, 330, 500, 960, 1280, 1920, 3840]);
    expect(new Set(WIKIMEDIA_STANDARD_WIDTHS).size).toBe(11);
  });

  it("解析の目標短辺は 1024 px(SPEC §3.6)", () => {
    expect(TARGET_SHORT_SIDE).toBe(1024);
  });
});

describe("T-012 幅の選択規則", () => {
  it("実測 4 作品はいずれも 1920 を選ぶ", () => {
    for (const m of MEASURED) {
      expect(chooseWikimediaWidth(m.w, m.h)?.width, m.name).toBe(1920);
    }
  });

  it("選んだ幅で短辺が 1024 に届く(実測の短辺と一致する)", () => {
    // 実測(2026-08-31)の 1920px 短辺: 1082 / 1490 / 1278 / 1291
    const measuredShort = [1082, 1490, 1278, 1291];
    MEASURED.forEach((m, i) => {
      const pick = chooseWikimediaWidth(m.w, m.h)!;
      // 実測はサーバの丸めを経た整数。±1 px の丸め差を許す
      expect(Math.abs(pick.shortSide - measuredShort[i]), m.name).toBeLessThanOrEqual(1);
      expect(pick.shortSide).toBeGreaterThanOrEqual(TARGET_SHORT_SIDE);
    });
  });

  it("1280 では 4 作品とも短辺が届かない(実測 721 / 993 / 852 / 860)", () => {
    // 「1920 が既定」の根拠を検査の側にも持つ。1280 で足りるなら規則を変えるべきである
    const at1280 = [721, 993, 852, 860];
    MEASURED.forEach((m, i) => {
      const short = Math.round(1280 * Math.min(1, m.h / m.w));
      expect(Math.abs(short - at1280[i]), m.name).toBeLessThanOrEqual(1);
      expect(short).toBeLessThan(TARGET_SHORT_SIDE);
    });
  });
});

describe("T-012b 白名簿の外を要求しない", () => {
  it("任意の (W,H) 1,000 通りで、選ばれた幅が常に 11 幅に属する", () => {
    const rng = createRng(20260831);
    const std = new Set<number>(WIKIMEDIA_STANDARD_WIDTHS);
    let picked = 0;
    for (let i = 0; i < 1000; i++) {
      const w = 200 + Math.floor(rng() * 30000);
      const h = 200 + Math.floor(rng() * 30000);
      const r = chooseWikimediaWidth(w, h);
      if (r === null) continue;
      expect(std.has(r.width), `${w}x${h} で ${r.width} を選んだ`).toBe(true);
      picked++;
    }
    // 走査対象が空でないことを確かめる(HC-041)
    expect(picked).toBeGreaterThan(500);
  });

  it("陽性対照 —— 白名簿を無視する版はこの検査に捕まる", () => {
    const naive = (W: number, H: number) => Math.ceil(TARGET_SHORT_SIDE * Math.max(1, W / H));
    const std = new Set<number>(WIKIMEDIA_STANDARD_WIDTHS);
    // 最後の晩餐 5193x2926 → 1817(白名簿外)
    expect(std.has(naive(5193, 2926))).toBe(false);
  });

  it("URL は選ばれた幅だけで組み立てられる", () => {
    const orig = "https://upload.wikimedia.org/wikipedia/commons/4/4b/Foo.jpg";
    const url = wikimediaThumbUrl(orig, 1920);
    expect(url).toBe("https://upload.wikimedia.org/wikipedia/commons/thumb/4/4b/Foo.jpg/1920px-Foo.jpg");
  });

  it("白名簿外の幅で URL を作ろうとしたら例外にする(黙って通る道を残さない — HC-075)", () => {
    const orig = "https://upload.wikimedia.org/wikipedia/commons/4/4b/Foo.jpg";
    expect(() => wikimediaThumbUrl(orig, 1024)).toThrow();
  });
});

describe("T-012c 拡大の拒否(実測: 3840px は原寸 3820 幅でも 400 にならず拡大して返る)", () => {
  it("要求幅が原寸幅を超える作品は候補にしない", () => {
    // 短辺 1024 に届かせるには原寸幅を超える標準幅が要る、細長い小さな画像
    const r = chooseWikimediaWidth(1500, 300);
    // 必要幅 = 1024 × (1500/300) = 5120 → 標準幅では 3840 が最大で、しかも原寸 1500 を超える
    expect(r).toBeNull();
  });

  it("原寸幅 3820 に対して 3840 を選ばない(拡大補間を解析に入れない)", () => {
    // アテナイの学堂。必要幅 = 1024 × 3820/2964 = 1320 → 1920 で足りるので 3840 は選ばれない
    const r = chooseWikimediaWidth(3820, 2964)!;
    expect(r.width).toBeLessThanOrEqual(3820);
    expect(r.width).toBe(1920);
  });

  it("届かない作品は null を返し、理由を持つ(黙って落とさない)", () => {
    const r = chooseWikimediaWidth(600, 400);
    // 必要幅 = 1024 × 1.5 = 1536 > 原寸 600。標準幅 1920 は拡大になる
    expect(r).toBeNull();
  });
});

describe("T-012d 404 が観測できる経路で問い合わせている", () => {
  it("非標準幅では不在が 400 に化けるので、標準幅以外を組み立てない", () => {
    const src = readFileSync("src/core/imageSource.ts", "utf8");
    // 幅を外から素通しする関数を持たない。wikimediaThumbUrl は白名簿を検査してから組む
    expect(src).toMatch(/WIKIMEDIA_STANDARD_WIDTHS/);
    expect(src).toMatch(/throw/);
  });

  it("400 と 404 を別の意味に分類する(実測 2026-08-31 の表)", () => {
    expect(classifyFailure(400)).toBe("width-not-standard");
    expect(classifyFailure(404)).toBe("not-found");
    expect(classifyFailure(200)).toBe("ok");
  });

  it("非標準幅では 404 が観測できないことを分類器が知っている", () => {
    // 400 は「幅が悪い」であって「ファイルが無い」ではない。
    // 実測: 不在ファイル × 非標準幅 = 400、不在ファイル × 標準幅 = 404(SPEC §3.2)
    expect(classifyFailure(400)).not.toBe("not-found");
  });
});
