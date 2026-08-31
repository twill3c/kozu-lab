import { SUBJECT_LINE } from "@/core/overlay";
import sigma from "@/data/sigma.json";
import saliency from "@/data/saliency.json";

type SigmaFile = {
  n: number;
  rows: { sigmaPct: number; peakT: number; peakZ: number; residual: Record<string, number> }[];
};
const SIGMA = sigma as unknown as SigmaFile;
const SAL = saliency as unknown as { meanAuc: number; medianAuc: number; n: number; threshold: number };

/** 落ちたゲートの一覧。**通ったものより、こちらの方が読む価値がある** */
const DROPPED = [
  {
    what: "消失点の精度(画素)",
    declared: "画素誤差 ≤ 短辺の 1 %",
    result: "落ちた。消失点が遠いほど発散する(画面対角の 14.2 倍で 326 px)",
    action: "物差しを角度に取り替えた。距離を縛らない絶対画素は物差しにならない",
  },
  {
    what: "消失点の精度(角度)",
    declared: "3D 方向の角度誤差 ≤ 1.0°",
    result: "ホールドアウトで 1.511°。実装の欠陥を 1 つ直したが、別の機で 2.044°",
    action:
      "そこで止めた —— ホールドアウトを二度見た時点で、それはもうホールドアウトではない。合わせて動かせば当てはめになる",
  },
  {
    what: "消失点の不確かさの較正",
    declared: "誤差が申告 3σ に収まる割合 ≥ 95 %",
    result: "シード 40 台で 90.0 %。ただし検出率と較正を混ぜた指標だった",
    action:
      "分けて測り直し、ゲートを撤回して測定に格下げ。検出率 81.3 % / 対応づいた分の被覆率 96.9 %(別シードで 82.5 % / 92.4 %)",
  },
  {
    what: "⑥ 視線の順路",
    declared: "AUC-Judd ≥ 0.75 なら出す",
    result: `${SAL.meanAuc.toFixed(4)}(n=${SAL.n})`,
    action: "**⑥ ごと削除した。**画面も順路線の図も作っていない",
  },
  {
    what: "⑦ 作品くらべの主張",
    declared: "西洋絵画の対角線構図と浮世絵の平行・分断構図の差が数値として出るはず",
    result:
      "hanshoku-atlas とは部門が違い objectID が定義上重ならない。加えて、縁を除くと 28.5 % の作品で直線が 0 本になる",
    action: "「時代差を示す」から「直線として検出できる構図線がどれだけ乏しいかを示す」へ格下げ",
  },
  {
    what: "解像度の交絡(§3.6)",
    declared: "Hough が拾う直線の本数は解像度の関数である",
    result: "合成画像では支持されず(419/1024/1490 でいずれも 5 本)。実作品では支持された(z が最大 1.03 動く)",
    action: "一度見込みへ格下げし、規律(短辺 1024 への正規化)だけを残した。実作品で断定に戻した",
  },
  {
    what: "二実装照合の射程(G-06)",
    declared: "投票配列が完全一致",
    result:
      "IEEE 754 が正しい丸めを義務づけるのは sqrt だけ。cos 44/2000・sin 50/2000・exp 187/2000 が言語間で食い違う",
    action:
      "完全一致は整数・四則・sqrt の区間だけに要求し、超越関数を通る先は測定にした。**閾値の緩和ではなく射程の切り直し**",
  },
  {
    what: "標本枠(§3.3)",
    declared: "④ の標本枠は MetObjects.csv(317 MB)",
    result: "不要だった。objects エンドポイントが 2,644 件の objectID を全部返す",
    action: "検索 API の頭打ちを過剰に一般化していた。CSV は使っていない",
  },
  {
    what: "「名画」の切り分け(§3.7)",
    declared: "名画 N=200 と一般絵画 N=200 を比べる",
    result: "isHighlight は dept 11 で 125 件しかなく、検定力 N ≥ 175 に届かない",
    action: "A 群を「絵画一般」に定義し直し、主張を A 群 vs 破壊版(対応あり)と A 群 vs 合成対照群へ寄せた",
  },
];

export default function Page() {
  return (
    <main>
      <h1>この道具について</h1>
      <p className="subject">{SUBJECT_LINE}</p>

      <h2>なぜ「見つける」ではなく「見つかってしまうことを測る」のか</h2>
      <p className="note">
        名画に三分割法や黄金分割の格子を重ねた図は、ネット上に無数にある。そのほとんどは、拡大率・回転・反転・
        「合っている」と数える特徴を自由に選んでいる。<strong>十分な自由度があれば、任意の画像に任意の格子を当てられる。</strong>
        数学史の側からは Mario Livio らがこの点を繰り返し指摘してきた —— 黄金螺旋を重ねた図の多くは、
        螺旋の大きさと位置を都合よく調整している、という批判である。
      </p>
      <p className="note">
        したがって「名画の構図線を自動抽出する」道具を素直に作ると、その擬似科学の量産機になる。
        この道具はそこで向きを反転させている ——{" "}
        <strong>主張は「構図線を見つけること」ではなく、「構図線がいかに容易に見つかってしまうかを測ること」に置く。</strong>
      </p>
      <p className="note">
        Livio の批判は「黄金比は名画に無い」という主張ではなく、
        <strong>「あるという主張の測り方が緩い」</strong>という主張である。この道具はその測り方の側を作った。
        だから ④ の答えが「差がほとんど無い」であっても、それは失敗ではない ——
        <strong>問いを検証できる形に置いた、という一点で価値が確定する</strong>設計にしてある。
      </p>

      <h2>画面は二層に分かれている</h2>
      <table>
        <thead>
          <tr>
            <th></th>
            <th>客観層</th>
            <th>規範層</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th>実在</th>
            <td>画像の画素から測れる</td>
            <td>見る側が事後に重ねる</td>
          </tr>
          <tr>
            <th>中身</th>
            <td>直線検出・消失点・明度重心・エッジ角度分布</td>
            <td>三分割・黄金分割・√2/√3/√5・対角線法・動的対称・アルマチュア</td>
          </tr>
          <tr>
            <th>描き方</th>
            <td>
              <strong>実線</strong>
            </td>
            <td>
              <strong>破線</strong>
            </td>
          </tr>
          <tr>
            <th>凡例の語</th>
            <td>測定</td>
            <td>重ねた格子</td>
          </tr>
          <tr>
            <th>正解</th>
            <td>合成画像で作れる</td>
            <td>
              <strong>作れない。だから ④ が要る</strong>
            </td>
          </tr>
        </tbody>
      </table>
      <p className="note">
        この描き分けは装飾ではなく、テストで守られている ——
        SVG の線を描くファイルが破線の指定を経由していなければ、検査が落ちる。
      </p>

      <h2>許容幅 σ を動かしても結論は変わらない</h2>
      <p className="note">
        当てはまりスコアには σ(許容幅)という宣言値がある。動かせば結論が変わるかもしれないので、
        <strong>実作品 {SIGMA.n} 件の走査を σ = 0.5 / 1 / 2 % で作り直した</strong>(短辺に対する比)。
      </p>
      <table>
        <thead>
          <tr>
            <th className="num">σ</th>
            <th className="num">曲線の頂点 t</th>
            <th className="num">三分割 1/3</th>
            <th className="num">三分割 2/3</th>
            <th className="num">黄金 0.382</th>
            <th className="num">黄金 0.618</th>
            <th className="num">中央 0.5</th>
          </tr>
        </thead>
        <tbody>
          {SIGMA.rows.map((r) => (
            <tr key={r.sigmaPct}>
              <th className="num">{r.sigmaPct} %</th>
              <td className="num">{r.peakT.toFixed(3)}</td>
              {["三分割 1/3", "三分割 2/3", "黄金 0.382", "黄金 0.618", "中央 0.5"].map((k) => (
                <td key={k} className="num">
                  {r.residual[k] >= 0 ? "+" : ""}
                  {r.residual[k].toFixed(3)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="note">
        σ を 4 倍に振っても<strong>頂点は t = 0.460–0.465(中央)から動かず、三分割は一貫して最も低い</strong>。
        ④ の答えは σ の選び方に依存していない。
      </p>

      <h2>落ちたゲートの記録</h2>
      <p className="note">
        <strong>通ったゲートより、落ちたゲートの方が読む価値がある。</strong>
        この道具では閾値を一度も緩めていない —— 落ちたときは、測る量を取り替えるか、主張の側を格下げしてきた。
      </p>
      {DROPPED.map((d) => (
        <table key={d.what}>
          <tbody>
            <tr>
              <th style={{ width: "22%" }}>{d.what}</th>
              <td className="note">
                <strong>宣言:</strong> {d.declared}
              </td>
            </tr>
            <tr>
              <th></th>
              <td className="note">
                <strong>結果:</strong> {d.result}
              </td>
            </tr>
            <tr>
              <th></th>
              <td className="note">
                <strong>したこと:</strong> {d.action}
              </td>
            </tr>
          </tbody>
        </table>
      ))}

      <h2>出典と権利</h2>
      <table>
        <tbody>
          <tr>
            <th>作品</th>
            <td className="note">
              メトロポリタン美術館 European Paintings 部門のパブリックドメイン絵画 200 件(CC0)。
              枠は同部門の objectID 全 2,644 件で、適格 2,029 件から世紀の層別に抽出した。
              抽出規則と乱数シードはリポジトリに刻んである
            </td>
          </tr>
          <tr>
            <th>視線データ</th>
            <td className="note">
              Judd, Ehinger, Durand, Torralba (ICCV 2009) <i>Learning to predict where people look</i>。
              明示のライセンス文は無く「publicly available with this paper」と引用依頼のみ(取得 2026-08-31)。
              <strong>再配布していない</strong> —— 手元で AUC-Judd({SAL.meanAuc.toFixed(4)}、n={SAL.n})を測り、配るのは数だけ
            </td>
          </tr>
          <tr>
            <th>画像</th>
            <td className="note">
              <strong>この道具は画像を配っていない。</strong>
              事前計算はローカルで一度だけ行い、リポジトリにもこのサイトにも作品画像は置いていない。
              ここにあるのは、そこから計算した数だけである
            </td>
          </tr>
          <tr>
            <th>サーバ</th>
            <td className="note">
              サーバ関数を一つも持たない静的サイト。ビルド時に外部へ取りに行かない。
              閲覧しても、あなたの画像はどこへも送られない —— <strong>送る先を作っていない</strong>
            </td>
          </tr>
        </tbody>
      </table>

      <h2>この道具が言わないこと</h2>
      <ul className="note">
        <li>個別の作品について「黄金比を使っている / いない」とは言わない</li>
        <li>作者の意図を推定しない。良い構図・悪い構図の判定もしない</li>
        <li>視線の順路は出さない —— 較正できなかったので削った</li>
        <li>
          消失点は「どれだけ当てにならないか」を数で添えてしか出さない。
          <strong>合成画像に対してすら精度を保証できなかった</strong>
        </li>
      </ul>

      <p className="note">
        <a href="/">① 線を見る + ③ 格子</a> ・ <a href="/lab/">④ 帰無仮説の実験室</a> ・{" "}
        <a href="/vanish/">② 消失点</a> ・ <a href="/notan/">⑤ ノタン</a> ・ <a href="/kurabe/">⑦ 作品くらべ</a>
      </p>
    </main>
  );
}
