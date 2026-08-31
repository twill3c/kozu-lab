import VanishStage from "@/components/VanishStage";
import { SUBJECT_LINE } from "@/core/overlay";

export default function Page() {
  return (
    <main>
      <h1>② 消失点</h1>
      <p className="subject">{SUBJECT_LINE}</p>
      <p className="note">
        線遠近法を使った絵には、検証できる幾何構造がある。ただし
        <strong>その構造は「どこまで当てになるか」とセットでしか意味を持たない</strong> ——
        この画面は推定した点と一緒に、その不確かさを出す。
      </p>
      <VanishStage />
      <p className="note">
        <a href="/">① 線を見る + ③ 格子を重ねる</a> ・ <a href="/notan/">⑤ ノタン</a>
      </p>
    </main>
  );
}
