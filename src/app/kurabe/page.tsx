import CompareStage from "@/components/CompareStage";
import { SUBJECT_LINE } from "@/core/overlay";

export default function Page() {
  return (
    <main>
      <h1>⑦ 作品くらべ</h1>
      <p className="subject">{SUBJECT_LINE}</p>
      <p className="note">
        実作品 200 件を <strong>世紀の層</strong> で比べる。層は標本枠が刻んだ規則で決まっていて、
        分け方に判断は入らない。
      </p>
      <CompareStage />
      <p className="note">
        <a href="/">① 線を見る + ③ 格子</a> ・ <a href="/lab/">④ 帰無仮説の実験室</a> ・{" "}
        <a href="/vanish/">② 消失点</a> ・ <a href="/notan/">⑤ ノタン</a>
      </p>
    </main>
  );
}
