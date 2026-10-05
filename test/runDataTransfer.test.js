'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadGasLogic, createGasEnvironment } = require('../test-support/loadGasLogic');

const {
  runDataTransfer,
  setupDemoSheets,
  SAMPLE_INPUT_ROWS,
  SHEET_NAMES,
  INPUT_HEADERS
} = loadGasLogic();

// 初期設定（setupDemoSheets）を実行した直後の状態を作る
function createDemoEnvironment(options = {}) {
  const env = createGasEnvironment(options);
  setupDemoSheets();
  env.alerts.length = 0;
  return env;
}

function formatDate(date) {
  return date.getFullYear() + '/' + (date.getMonth() + 1) + '/' + date.getDate();
}

test('初期設定：5つのシートと架空のサンプルデータを作成する', () => {
  const env = createGasEnvironment();
  setupDemoSheets();

  assert.deepEqual(Object.keys(env.sheets).sort(), Object.values(SHEET_NAMES).sort());
  const input = env.sheets[SHEET_NAMES.INPUT];
  assert.deepEqual(input.rows[0], INPUT_HEADERS);
  assert.equal(input.dataRows().length, SAMPLE_INPUT_ROWS.length);
  assert.match(env.alerts[0], /初期設定が完了しました/);
});

test('初期設定：既にあるシートの内容は上書きしない', () => {
  const env = createGasEnvironment({
    sheets: { [SHEET_NAMES.INPUT]: [INPUT_HEADERS.slice(0, 6), ['2026/09/01', '自社データ', 'ロゴデザイン', '山田', '1000', '受付']] }
  });
  setupDemoSheets();
  assert.equal(env.sheets[SHEET_NAMES.INPUT].dataRows().length, 1);
  assert.equal(env.sheets[SHEET_NAMES.INPUT].rows[1][1], '自社データ');
});

test('サンプルデータ：正常6件を整理済みデータへ、5件を要確認へ、2件を重複除外にする', () => {
  const env = createDemoEnvironment();
  runDataTransfer();

  const cleaned = env.sheets[SHEET_NAMES.CLEANED].dataRows();
  assert.deepEqual(cleaned.map((r) => [formatDate(r[0])].concat(r.slice(1, 7))), [
    ['2026/9/1', '株式会社サンプル商事', 'Webサイト制作', '山田', 150000, '完了', 2],
    ['2026/9/2', 'テスト工業株式会社', 'ロゴデザイン', '山田', 50000, '対応中', 3],
    ['2026/9/3', 'サンプル企画', '名刺デザイン', '佐藤', 20000, '受付', 4],
    ['2026/9/4', '株式会社デモ物産', 'Webサイト制作', '鈴木', 300000, '受付', 5],
    ['2026/9/8', 'ABCデザイン事務所', 'Webサイト制作', '山田', 180000, '完了', 10],
    ['2026/9/10', 'テスト工業株式会社', 'チラシ作成', '鈴木', 35000, '対応中', 12]
  ]);

  const review = env.sheets[SHEET_NAMES.REVIEW].dataRows();
  assert.deepEqual(review.map((r) => [r[0], r[7]]), [
    [7, '顧客名が未入力です'],
    [8, '金額を数値に変換できません（入力値: 三万円）'],
    [9, '受付日が不正です（入力値: 2026/13/01）'],
    [11, 'ステータスが未入力です'],
    [14, '担当者が未入力です']
  ]);
  // 要確認データは元の入力値のまま残す（勝手に削除・修正しない）
  assert.deepEqual(review[1].slice(1, 7), SAMPLE_INPUT_ROWS[6]);
  assert.equal(env.sheets[SHEET_NAMES.INPUT].dataRows().length, SAMPLE_INPUT_ROWS.length);

  const results = env.sheets[SHEET_NAMES.INPUT].dataRows().map((r) => r[6]);
  assert.deepEqual(results, [
    '転記済み', '転記済み', '転記済み', '転記済み',
    '重複除外（3行目と同じ内容）',
    '要確認', '要確認', '要確認',
    '転記済み', '要確認', '転記済み',
    '重複除外（3行目と同じ内容）',
    '要確認'
  ]);

  assert.equal(env.alerts.length, 1);
  assert.match(env.alerts[0], /正常処理（整理済みデータへ新規転記）：6件/);
  assert.match(env.alerts[0], /要確認：5件/);
  assert.match(env.alerts[0], /重複除外：2件/);
});

test('集計：整理済みデータから総件数・売上合計・担当者別・ステータス別を表示する', () => {
  const env = createDemoEnvironment();
  runDataTransfer();

  assert.deepEqual(env.sheets[SHEET_NAMES.SUMMARY].rows, [
    ['受注データ集計', '', ''],
    ['最終更新', '2026/10/05 12:00', ''],
    ['', '', ''],
    ['総受注件数', 6, ''],
    ['売上合計', 735000, ''],
    ['', '', ''],
    ['担当者別', '件数', '売上'],
    ['山田', 3, 380000],
    ['佐藤', 1, 20000],
    ['鈴木', 2, 335000],
    ['', '', ''],
    ['ステータス別', '件数', ''],
    ['完了', 2, ''],
    ['対応中', 2, ''],
    ['受付', 2, '']
  ]);
});

test('二重転記防止：同じデータで何度実行しても整理済みデータ・集計は増えない', () => {
  const env = createDemoEnvironment();
  runDataTransfer();
  const firstCleaned = JSON.stringify(env.sheets[SHEET_NAMES.CLEANED].rows);
  const firstSummary = JSON.stringify(env.sheets[SHEET_NAMES.SUMMARY].rows);

  runDataTransfer();
  runDataTransfer();

  assert.equal(JSON.stringify(env.sheets[SHEET_NAMES.CLEANED].rows), firstCleaned);
  assert.equal(JSON.stringify(env.sheets[SHEET_NAMES.SUMMARY].rows), firstSummary);
  assert.equal(env.sheets[SHEET_NAMES.REVIEW].dataRows().length, 5);
  assert.match(env.alerts[2], /正常処理（整理済みデータへ新規転記）：0件/);
  assert.match(env.alerts[2], /転記済みのためスキップ：6件/);
  assert.match(env.alerts[2], /重複除外：2件/);
});

test('要確認の再実行：入力データを修正して再実行すると、その行だけが追加で転記される', () => {
  const env = createDemoEnvironment();
  runDataTransfer();

  const input = env.sheets[SHEET_NAMES.INPUT];
  input.setCell(7, 2, 'デモ印刷所'); // 7行目：顧客名が未入力だった行
  input.setCell(8, 5, '30,000'); // 8行目：金額が「三万円」だった行
  runDataTransfer();

  const cleaned = env.sheets[SHEET_NAMES.CLEANED].dataRows();
  assert.equal(cleaned.length, 8);
  assert.deepEqual(cleaned.slice(6).map((r) => [r[1], r[4], r[6]]), [
    ['デモ印刷所', 30000, 7],
    ['サンプル食堂', 30000, 8]
  ]);
  assert.deepEqual(env.sheets[SHEET_NAMES.REVIEW].dataRows().map((r) => r[0]), [9, 11, 14]);
  assert.match(env.alerts[1], /正常処理（整理済みデータへ新規転記）：2件/);
  assert.match(env.alerts[1], /要確認：3件/);
  assert.match(env.alerts[1], /転記済みのためスキップ：6件/);
  assert.equal(env.sheets[SHEET_NAMES.SUMMARY].rows[3][1], 8);
});

test('二重転記防止：入力シートを新しいデータに入れ替えても、転記済みの内容は追加しない', () => {
  const env = createDemoEnvironment();
  runDataTransfer();

  const input = env.sheets[SHEET_NAMES.INPUT];
  input.clearContents();
  input.rows.push(INPUT_HEADERS.slice());
  input.rows.push(['2026/9/1', '株式会社サンプル商事', 'Webサイト制作', 'ヤマダ', '¥150,000', '完了']); // 転記済みと同じ内容
  input.rows.push(['2026/09/12', 'デモ書店', '名刺デザイン', '佐藤', '15000', '受付']); // 新しいデータ
  runDataTransfer();

  const cleaned = env.sheets[SHEET_NAMES.CLEANED].dataRows();
  assert.equal(cleaned.length, 7);
  assert.equal(cleaned[6][1], 'デモ書店');
  assert.match(env.alerts[1], /正常処理（整理済みデータへ新規転記）：1件/);
  assert.match(env.alerts[1], /転記済みのためスキップ：1件/);
  // 要確認シートは現在の入力データの内容で作り直される
  assert.equal(env.sheets[SHEET_NAMES.REVIEW].dataRows().length, 0);
});

test('同時実行の防止：ロックを取得できない場合は何も変更しない', () => {
  const env = createGasEnvironment({ lockAvailable: false });
  setupDemoSheets();
  env.alerts.length = 0;
  runDataTransfer();

  assert.equal(env.sheets[SHEET_NAMES.CLEANED].dataRows().length, 0);
  assert.equal(env.sheets[SHEET_NAMES.INPUT].dataRows()[0][6], undefined);
  assert.match(env.alerts[0], /別の整理・転記処理が実行中です/);
});

test('ロック：処理後は必ずロックを解放する', () => {
  const env = createDemoEnvironment();
  runDataTransfer();
  assert.deepEqual(env.lockState, { acquired: 1, released: 1 });
});

test('入力データシートがない・ヘッダーが違う場合は処理せずに案内を表示する', () => {
  const missing = createGasEnvironment();
  runDataTransfer();
  assert.match(missing.alerts[0], /「入力データ」シートがありません/);

  const wrongHeader = createGasEnvironment({
    sheets: { [SHEET_NAMES.INPUT]: [['日付', '顧客名', '商品名', '担当者', '金額', 'ステータス'], ['2026/09/01', 'A社', 'ロゴデザイン', '山田', '1000', '受付']] }
  });
  runDataTransfer();
  assert.match(wrongHeader.alerts[0], /1列目が「受付日」ではありません/);
  assert.equal(wrongHeader.sheets[SHEET_NAMES.CLEANED], undefined);
  assert.deepEqual(wrongHeader.lockState, { acquired: 1, released: 1 });
});

test('表記ゆれ設定シートがなくても、空白・全角半角の整理だけで処理できる', () => {
  const env = createGasEnvironment({
    sheets: {
      [SHEET_NAMES.INPUT]: [
        INPUT_HEADERS.slice(0, 6),
        ['２０２６/９/１', ' Ａ社 ', 'ロゴデザイン', 'ﾔﾏﾀﾞ', '1,000円', '受付']
      ]
    }
  });
  runDataTransfer();
  const cleaned = env.sheets[SHEET_NAMES.CLEANED].dataRows();
  assert.deepEqual(cleaned[0].slice(1, 6), ['A社', 'ロゴデザイン', 'ヤマダ', 1000, '受付']);
});
