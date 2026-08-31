// 二層の描き分け(SPEC §2 / G-11)。
//
// 客観層は **実線**、規範層は **破線**。凡例の語も「測定」と「重ねた格子」で分ける。
// これは装飾ではなく主張の一部である —— 絵の中に実在するものと、
// 見る側が事後に重ねたものを、画面上で取り違えさせない。
//
// 画面側は素の <line> を書かず、必ずここを経由する(T-014 が静的に検査する)。

export type Layer = "objective" | "normative";

export type LayerStyle = {
  legend: string;
  stroke: string;
  strokeWidth: number;
  strokeDasharray?: string;
  opacity: number;
};

export const LAYER_STYLE: Record<Layer, LayerStyle> = {
  objective: {
    legend: "測定",
    stroke: "#c8321e",
    strokeWidth: 1.4,
    opacity: 0.95,
  },
  normative: {
    legend: "重ねた格子",
    stroke: "#5b6b7a",
    strokeWidth: 1,
    strokeDasharray: "6 5",
    opacity: 0.75,
  },
};

export function layerStyle(layer: Layer): LayerStyle {
  return LAYER_STYLE[layer];
}

/** 画面に出す主語(SPEC §1 / F-08)。短くしない */
export const SUBJECT_LINE =
  "本ページが測るのは「与えられた画像に対し、我々が定義した当てはまりスコアが、" +
  "我々が選んだ対照群の分布のどこに立つか」である。構図線が絵の中に描かれているわけではない。";
