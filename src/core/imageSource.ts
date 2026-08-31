// F-07 画像取得。SPEC §3.2 / §3.6。
//
// Wikimedia のサムネイル幅は **白名簿制** である(権威: mediawiki.org/wiki/Common_thumbnail_sizes、
// $wgThumbnailSteps の Wikimedia 本番値 / phab:T414805。取得日 2026-08-31)。
// 実測(2026-08-31): 4 作品 × 26 幅 = 104 リクエストで、標準 11 幅は 44/44 が 200、
// 非標準 15 幅は 60/60 が 400。例外ゼロ。
//
// **幅の検査は存在の検査より先に効く。**非標準幅で問い合わせている限り、
// ファイルが在るか無いかは原理的に分からない(不在ファイルでも 400 が返る)。
// したがって取得器は必ず標準幅で組み立てる —— そうして初めて 404 が「候補が悪い」を意味する。

/** $wgThumbnailSteps の Wikimedia 本番値(11 幅) */
export const WIKIMEDIA_STANDARD_WIDTHS = [
  20, 40, 60, 120, 250, 330, 500, 960, 1280, 1920, 3840,
] as const;

/** 解析の目標短辺(SPEC §3.6) */
export const TARGET_SHORT_SIDE = 1024;

export type WidthChoice = {
  width: number;
  /** その幅で得られるサムネイルの短辺 */
  shortSide: number;
};

/**
 * 幅の選択規則(SPEC §3.2)。
 *
 *   必要幅 = 目標短辺 × max(1, W/H)
 *   要求幅 = 必要幅以上で最小の標準幅
 *
 * ただし **要求幅 ≤ 原寸幅** を満たさないものは null を返す。
 * 標準幅は原寸を超えても 400 にならず **拡大して返る**(実測: 原寸幅 3820 の作品に
 * 3840px を要求すると 3840×2980 が返る)。拡大補間のエッジは Canny にとって偽の線源になる。
 */
export function chooseWikimediaWidth(
  originalWidth: number,
  originalHeight: number,
  targetShortSide: number = TARGET_SHORT_SIDE,
): WidthChoice | null {
  if (originalWidth <= 0 || originalHeight <= 0) return null;
  const needed = targetShortSide * Math.max(1, originalWidth / originalHeight);
  const width = WIKIMEDIA_STANDARD_WIDTHS.find((w) => w >= needed);
  if (width === undefined) return null;
  if (width > originalWidth) return null;
  const shortSide = Math.round(width * Math.min(1, originalHeight / originalWidth));
  return { width, shortSide };
}

/**
 * 原寸 URL からサムネイル URL を組む。
 * 白名簿の外の幅を渡したら **例外にする** —— 黙って通る道を残さない(HC-075)。
 */
export function wikimediaThumbUrl(originalUrl: string, width: number): string {
  if (!(WIKIMEDIA_STANDARD_WIDTHS as readonly number[]).includes(width)) {
    throw new Error(
      `幅 ${width} は Wikimedia の標準幅ではない。非標準幅では 400 が返り、しかも 404 と区別できなくなる(SPEC §3.2)`,
    );
  }
  const marker = "/commons/";
  const at = originalUrl.indexOf(marker);
  if (at < 0) throw new Error(`Wikimedia Commons の原寸 URL ではない: ${originalUrl}`);
  const name = originalUrl.slice(originalUrl.lastIndexOf("/") + 1);
  const thumbBase = originalUrl.slice(0, at) + "/commons/thumb/" + originalUrl.slice(at + marker.length);
  return `${thumbBase}/${width}px-${name}`;
}

export type FetchOutcome = "ok" | "width-not-standard" | "not-found" | "other";

/**
 * 応答コードの意味づけ(実測 2026-08-31)。
 *
 * |              | 標準幅 1920 | 非標準幅 1024 |
 * |--------------|------------|--------------|
 * | 実在ファイル    | 200        | 400          |
 * | 不在ファイル    | **404**    | 400          |
 * | ハッシュ不一致  | **404**    | 400          |
 *
 * 400 は「幅が悪い」であって「ファイルが無い」ではない。
 */
export function classifyFailure(status: number): FetchOutcome {
  if (status === 200) return "ok";
  if (status === 400) return "width-not-standard";
  if (status === 404) return "not-found";
  return "other";
}

/** 出典。CORS はいずれも実測済み(SPEC §3.1) */
export const SOURCES = {
  met: {
    name: "メトロポリタン美術館",
    license: "CC0",
    note: "web-large は短辺 419 px の実例あり(SPEC §3.4)。original も ACAO: *",
  },
  nga: {
    name: "ワシントン・ナショナル・ギャラリー",
    license: "CC0",
    note: "IIIF が 200 + ACAO: *(実測 2026-08-31)",
  },
  wikimedia: {
    name: "Wikimedia Commons",
    license: "作品ごとに確認(PD / CC0 のみ採る)",
    note: "サムネイル幅は白名簿制。原寸は 228.9 MB の実例があるので使わない",
  },
} as const;
