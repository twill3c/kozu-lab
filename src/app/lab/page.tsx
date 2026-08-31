import LabStage from "@/components/LabStage";
import { SUBJECT_LINE } from "@/core/overlay";

export default function Page() {
  return (
    <main>
      <h1>④ 帰無仮説の実験室</h1>
      <p className="subject">{SUBJECT_LINE}</p>
      <p className="note">
        「黄金分割は名画に多いか」を、1/3 と 0.618 だけ測って答えてはならない ——
        <strong>その二つを測ったという事実が、結論の形を先に決めてしまう</strong>。
        だから測る対象を比そのものにして、0.05 から 0.95 まで走査する。
      </p>
      <LabStage />
      <p className="note">
        <a href="/">① 線を見る + ③ 格子を重ねる</a> ・ <a href="/vanish/">② 消失点</a> ・{" "}
        <a href="/notan/">⑤ ノタン</a>
      </p>
    </main>
  );
}
