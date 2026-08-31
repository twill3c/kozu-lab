import NotanStage from "@/components/NotanStage";
import { SUBJECT_LINE } from "@/core/overlay";

export default function Page() {
  return (
    <main>
      <h1>⑤ ノタン</h1>
      <p className="subject">{SUBJECT_LINE}</p>
      <p className="note">
        絵を明暗の面の構成として見る。段数としきい値は分析者が選ぶ ——
        選び方が変われば面の構成も変わる。
      </p>
      <NotanStage />
      <p className="note">
        <a href="/">① 線を見る + ③ 格子を重ねる へ</a>
      </p>
    </main>
  );
}
