// F-14 標本枠。**抽出規則と乱数シードをファイルに刻む**(SPEC §8.2)。
//
// Met の objects エンドポイントは部門の objectID を全部返す(実測 2026-08-31: dept 11 で 2,644 件)。
// SPEC §3.3 は MetObjects.csv(317 MB)を枠にすると書いていたが、**それは要らない**。
//
// 手順:
//   1. 2,644 件の objectID を取る(= 枠の全体)
//   2. 全件のメタデータを取り、`data/frames/met-ep-catalog.json` に残す
//      —— 枠の全体が分かっていないと、抽出が偏っていないことを後から確かめられない
//   3. 適格条件で絞り、**年代の層で分けてから**シード固定で抽出する
//
// **画像は落とさない。**ここで作るのはメタデータの枠だけである(N-03)。
//
// 実行: node scripts/build-frame.mjs

import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";

const UA = "kozu-lab-research/0.1 (twill3c@gmail.com)";
const BASE = "https://collectionapi.metmuseum.org/public/collection/v1";
const DEPT = 11; // European Paintings
const OUT_DIR = "data/frames";
const CATALOG = `${OUT_DIR}/met-ep-catalog.json`;
const FRAME = `${OUT_DIR}/met-ep.json`;
const SEED = 20260831;
const TARGET = 200; // SPEC §8.1: 検定力から N=200

/** mulberry32。src/core/rng.ts と同じ仕様 */
function createRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 実測 2026-08-31: 並列度 6 で 2,644 件を叩くと途中で連続失敗した(レート制限)。
// 並列度を 2 に落とし、**429 と 5xx は指数的に待って再試行する**。
// 待ち時間を刻んでおかないと、失敗が「取れなかった件」として静かに落ちる。
async function getJson(url, tries = 8) {
  let lastStatus = 0;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA } });
      lastStatus = r.status;
      if (r.status === 200) return await r.json();
      if (r.status === 404) return null;
    } catch (e) {
      lastStatus = -1;
    }
    await new Promise((res) => setTimeout(res, Math.min(20000, 600 * 2 ** i)));
  }
  throw new Error(`取得できない(最後の応答 ${lastStatus}): ${url}`);
}

const KEEP = [
  "objectID",
  "isHighlight",
  "isPublicDomain",
  "primaryImage",
  "primaryImageSmall",
  "title",
  "artistDisplayName",
  "objectDate",
  "objectBeginDate",
  "objectEndDate",
  "classification",
  "medium",
  "objectURL",
];

async function buildCatalog() {
  const list = await getJson(`${BASE}/objects?departmentIds=${DEPT}`);
  const ids = list.objectIDs;
  console.log(`枠の全体: ${ids.length} 件`);

  const rows = [];
  let done = 0;
  const CONC = 2;
  const queue = [...ids];
  const workers = Array.from({ length: CONC }, async () => {
    while (queue.length) {
      const id = queue.shift();
      const d = await getJson(`${BASE}/objects/${id}`);
      done++;
      if (done % 200 === 0) console.log(`  ${done}/${ids.length}`);
      if (!d) continue;
      const row = {};
      for (const k of KEEP) row[k] = d[k];
      rows.push(row);
    }
  });
  await Promise.all(workers);
  rows.sort((a, b) => a.objectID - b.objectID);
  return { total: ids.length, rows };
}

function eligible(r) {
  // **権利で落とす検査を先に置く。**適格条件は 3 つだけで、すべて機械可読の欄から決まる
  return (
    r.isPublicDomain === true &&
    typeof r.primaryImage === "string" &&
    r.primaryImage.length > 10 &&
    r.classification === "Paintings"
  );
}

/** 年代の層。世紀で切る(objectBeginDate と objectEndDate の中点) */
function stratum(r) {
  const b = Number(r.objectBeginDate);
  const e = Number(r.objectEndDate);
  if (!Number.isFinite(b) || !Number.isFinite(e)) return "不明";
  const mid = (b + e) / 2;
  return `${Math.floor(mid / 100) + 1}世紀`;
}

function stratifiedSample(rows, target, seed) {
  const rng = createRng(seed);
  const byStratum = new Map();
  for (const r of rows) {
    const s = stratum(r);
    if (!byStratum.has(s)) byStratum.set(s, []);
    byStratum.get(s).push(r);
  }
  // 各層を決定論的にシャッフル(Fisher–Yates)
  for (const arr of byStratum.values()) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }
  // 層の大きさに比例して配分し、端数は層名の順で埋める
  const names = [...byStratum.keys()].sort();
  const totalEligible = rows.length;
  const quota = new Map();
  let assigned = 0;
  for (const n of names) {
    const q = Math.floor((byStratum.get(n).length / totalEligible) * target);
    quota.set(n, q);
    assigned += q;
  }
  let i = 0;
  while (assigned < target) {
    const n = names[i % names.length];
    if (quota.get(n) < byStratum.get(n).length) {
      quota.set(n, quota.get(n) + 1);
      assigned++;
    }
    i++;
    if (i > names.length * 100) break;
  }
  const picked = [];
  for (const n of names) picked.push(...byStratum.get(n).slice(0, quota.get(n)));
  picked.sort((a, b) => a.objectID - b.objectID);
  return { picked, strata: Object.fromEntries(names.map((n) => [n, byStratum.get(n).length])) };
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  let catalog;
  if (existsSync(CATALOG)) {
    catalog = JSON.parse(readFileSync(CATALOG, "utf8"));
    console.log(`目録を再利用: ${catalog.rows.length} 件(消すには ${CATALOG} を削除)`);
  } else {
    catalog = await buildCatalog();
    catalog.fetchedAt = new Date().toISOString().slice(0, 10);
    writeFileSync(CATALOG, JSON.stringify(catalog));
    console.log(`目録を書いた: ${CATALOG}`);
  }

  const ok = catalog.rows.filter(eligible);
  console.log(`適格 ${ok.length} / 目録 ${catalog.rows.length} / 枠 ${catalog.total}`);
  const { picked, strata } = stratifiedSample(ok, TARGET, SEED);

  const frame = {
    source: "The Metropolitan Museum of Art Collection API",
    endpoint: `${BASE}/objects?departmentIds=${DEPT}`,
    license: "CC0(isPublicDomain: true の作品)",
    fetchedAt: catalog.fetchedAt,
    seed: SEED,
    rule:
      "European Paintings 部門(departmentIds=11)の objectID 全 2,644 件を枠とする。" +
      "適格条件は isPublicDomain === true / primaryImage を持つ / classification === 'Paintings' の 3 つ。" +
      "適格な作品を objectBeginDate と objectEndDate の中点の世紀で層に分け、" +
      "層の大きさに比例した割当で、シード 20260831 の mulberry32 による Fisher–Yates シャッフル順に採る。" +
      "端数は層名の昇順で埋める。画像は落とさない。",
    total: catalog.total,
    eligible: ok.length,
    strata,
    highlightCount: catalog.rows.filter((r) => r.isHighlight).length,
    members: picked,
  };
  writeFileSync(FRAME, JSON.stringify(frame, null, 1));
  console.log(`標本枠を書いた: ${FRAME} —— ${picked.length} 件 / 層 ${Object.keys(strata).length} 個`);
  console.log(`  層の内訳: ${Object.entries(strata).map(([k, v]) => `${k}:${v}`).join(" ")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
