import LineStage from "@/components/LineStage";
import { SUBJECT_LINE } from "@/core/overlay";

export default function Page() {
  return (
    <main>
      <h1>構図ラボ</h1>
      <p className="note">
        名画に構図の格子を重ねる行為そのものを測る。{SUBJECT_LINE.slice(0, 0)}
        主張は「構図線を見つけること」ではなく、「構図線がいかに容易に見つかってしまうかを測ること」に置く。
      </p>
      <h2>① 線を見る + ③ 格子を重ねる</h2>
      <LineStage />
      <h2>ほかの画面</h2>
      <p className="note">
        <a href="/notan/">⑤ ノタン —— 明暗の面と明度重心</a>
        <br />
        <a href="/vanish/">② 消失点 —— 破綻を破綻として返す</a>
        <br />
        <a href="/lab/">④ 帰無仮説の実験室 —— このアプリの主張はここにある</a>
      </p>
    </main>
  );
}
