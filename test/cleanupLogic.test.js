'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadGasLogic } = require('../test-support/loadGasLogic');

const {
  normalizeText_,
  buildAliasMap_,
  applyAlias_,
  parseOrderDate_,
  parseAmount_,
  cleanOrderRow_,
  buildRecordKey_,
  classifyRows_,
  aggregateSummary_,
  buildSummaryValues_,
  buildCompletionMessage_,
  SAMPLE_ALIAS_ROWS
} = loadGasLogic();

const ALIAS_MAP = buildAliasMap_(SAMPLE_ALIAS_ROWS);

function dateOf(year, month, day) {
  return new Date(year, month - 1, day);
}

// ===== 空白削除 =====

test('空白削除：前後の半角・全角スペースを削除し、連続する空白を1つにまとめる', () => {
  assert.equal(normalizeText_('  テスト工業株式会社 '), 'テスト工業株式会社');
  assert.equal(normalizeText_('　サンプル商事　'), 'サンプル商事');
  assert.equal(normalizeText_('株式会社　 サンプル   商事'), '株式会社 サンプル 商事');
  assert.equal(normalizeText_('\tデモ書店\n'), 'デモ書店');
});

test('空白削除：null・undefined・数値も文字列として扱う', () => {
  assert.equal(normalizeText_(null), '');
  assert.equal(normalizeText_(undefined), '');
  assert.equal(normalizeText_(120), '120');
});

// ===== 表記統一 =====

test('表記統一：全角英数字は半角、半角カタカナは全角に統一する', () => {
  assert.equal(normalizeText_('ＡＢＣデザイン事務所'), 'ABCデザイン事務所');
  assert.equal(normalizeText_('ｻﾝﾌﾟﾙ企画'), 'サンプル企画');
  assert.equal(normalizeText_('１２３'), '123');
});

test('表記統一：表記ゆれ設定に基づいて担当者名を統一する', () => {
  assert.equal(applyAlias_('山田 太郎', ALIAS_MAP, '担当者'), '山田');
  assert.equal(applyAlias_('山田　太郎', ALIAS_MAP, '担当者'), '山田');
  assert.equal(applyAlias_('ﾔﾏﾀﾞ', ALIAS_MAP, '担当者'), '山田');
  assert.equal(applyAlias_('ｻﾄｳ', ALIAS_MAP, '担当者'), '佐藤');
  assert.equal(applyAlias_('すずき', ALIAS_MAP, '担当者'), '鈴木');
});

test('表記統一：商品名・ステータスも設定に基づいて統一し、英字の大文字・小文字は区別しない', () => {
  assert.equal(applyAlias_('ＨＰ制作', ALIAS_MAP, '商品名'), 'Webサイト制作');
  assert.equal(applyAlias_('hp制作', ALIAS_MAP, '商品名'), 'Webサイト制作');
  assert.equal(applyAlias_('受付済', ALIAS_MAP, 'ステータス'), '受付');
  assert.equal(applyAlias_('対応済み', ALIAS_MAP, 'ステータス'), '完了');
});

test('表記統一：設定にない表記は、空白・全角半角だけ整えてそのまま残す', () => {
  assert.equal(applyAlias_(' 田中 ', ALIAS_MAP, '担当者'), '田中');
  assert.equal(applyAlias_('ロゴデザイン', ALIAS_MAP, '商品名'), 'ロゴデザイン');
});

test('表記統一：設定は対象項目ごとに適用され、他の項目には影響しない', () => {
  const map = buildAliasMap_([['担当者', '受付済', 'A'], ['存在しない項目', 'X', 'Y'], ['商品名', '', '空の変換元']]);
  assert.equal(applyAlias_('受付済', map, 'ステータス'), '受付済');
  assert.equal(applyAlias_('受付済', map, '担当者'), 'A');
  assert.deepEqual(Object.keys(map['商品名']), []);
});

// ===== 日付変換 =====

test('日付変換：さまざまな形式を同じ日付に統一する', () => {
  const expected = dateOf(2026, 9, 3).getTime();
  for (const input of ['2026/09/03', '2026/9/3', '2026-09-03', '2026.9.3', '2026年9月3日', '20260903', '２０２６／９／３', ' 2026/9/3 ', 20260903]) {
    const parsed = parseOrderDate_(input);
    assert.ok(parsed, input + ' を日付に変換できること');
    assert.equal(parsed.getTime(), expected, String(input));
  }
});

test('日付変換：スプレッドシートの日付は時刻を切り捨てる', () => {
  assert.equal(parseOrderDate_(new Date(2026, 8, 3, 15, 30)).getTime(), dateOf(2026, 9, 3).getTime());
});

test('日付変換：存在しない日付・不正な形式は null', () => {
  for (const input of ['2026/13/01', '2026/02/30', '2026/9', '9/3', '令和8年9月3日', 'あした', '2026/09/03 10:00', new Date('invalid'), 45000]) {
    assert.equal(parseOrderDate_(input), null, String(input));
  }
});

test('日付変換：うるう年の2月29日は正しく判定する', () => {
  assert.ok(parseOrderDate_('2028/02/29'));
  assert.equal(parseOrderDate_('2026/02/29'), null);
});

// ===== 金額変換 =====

test('金額変換：「¥」「￥」「円」「,」・全角数字・空白を取り除いて数値にする', () => {
  assert.equal(parseAmount_('150000'), 150000);
  assert.equal(parseAmount_('¥50,000'), 50000);
  assert.equal(parseAmount_('￥180,000'), 180000);
  assert.equal(parseAmount_('２０，０００円'), 20000);
  assert.equal(parseAmount_(' 35,000 '), 35000);
  assert.equal(parseAmount_('\\12,000'), 12000);
  assert.equal(parseAmount_(80000), 80000);
  assert.equal(parseAmount_(0), 0);
});

test('金額変換：数値に変換できない値・マイナス・小数は null', () => {
  for (const input of ['三万円', '未定', '50,000ドル', '-5000', '1000.5', '1e5', 1000.5, -1, NaN, Infinity]) {
    assert.equal(parseAmount_(input), null, String(input));
  }
});

// ===== 正常データ =====

test('正常データ：表記がバラバラでも整理後の値にそろえ、エラーなしになる', () => {
  const cleaned = cleanOrderRow_(['2026-09-02', '  テスト工業株式会社 ', 'ロゴデザイン', '山田 太郎', '¥50,000', '対応中'], ALIAS_MAP);
  assert.deepEqual(cleaned.errors, []);
  assert.equal(cleaned.record[0].getTime(), dateOf(2026, 9, 2).getTime());
  assert.deepEqual(cleaned.record.slice(1), ['テスト工業株式会社', 'ロゴデザイン', '山田', 50000, '対応中']);
});

// ===== 入力不足 =====

test('入力不足：未入力の項目ごとに理由を返す', () => {
  const cleaned = cleanOrderRow_(['', '  ', 'チラシ作成', '', '', ''], ALIAS_MAP);
  assert.deepEqual(cleaned.errors, [
    '受付日が未入力です',
    '顧客名が未入力です',
    '担当者が未入力です',
    '金額が未入力です',
    'ステータスが未入力です'
  ]);
});

test('入力不足：商品名の未入力も理由になる', () => {
  const cleaned = cleanOrderRow_(['2026/09/01', 'デモ書店', '　', '佐藤', '1000', '受付'], ALIAS_MAP);
  assert.deepEqual(cleaned.errors, ['商品名が未入力です']);
});

// ===== 不正データ =====

test('不正データ：受付日・金額が不正な場合は入力値付きの理由を返す', () => {
  const cleaned = cleanOrderRow_(['2026/13/01', 'デモ書店', 'ロゴデザイン', '佐藤', '三万円', '完了'], ALIAS_MAP);
  assert.deepEqual(cleaned.errors, [
    '受付日が不正です（入力値: 2026/13/01）',
    '金額を数値に変換できません（入力値: 三万円）'
  ]);
});

// ===== 重複除外 =====

test('重複除外：完全に同じ行は2件目以降を除外し、元の行番号を記録する', () => {
  const row = ['2026/09/01', '株式会社サンプル商事', 'Webサイト制作', '山田', '150000', '完了'];
  const result = classifyRows_([row, row.slice(), row.slice()], ALIAS_MAP, {}, 2);
  assert.equal(result.transfers.length, 1);
  assert.deepEqual(result.duplicates.map((d) => [d.rowNumber, d.duplicateOf]), [[3, 2], [4, 2]]);
  assert.deepEqual(result.rowResults, ['転記済み', '重複除外（2行目と同じ内容）', '重複除外（2行目と同じ内容）']);
});

test('重複除外：表記が違っても整理後の内容が完全に一致すれば重複として除外する', () => {
  const result = classifyRows_([
    ['2026-09-02', '  テスト工業株式会社 ', 'ロゴデザイン', '山田 太郎', '¥50,000', '対応中'],
    ['2026/9/2', 'テスト工業株式会社', 'ロゴデザイン', '山田', '50000', '対応中']
  ], ALIAS_MAP, {}, 2);
  assert.equal(result.transfers.length, 1);
  assert.equal(result.duplicates.length, 1);
});

test('重複除外：1項目でも内容が違えば別データとして扱う', () => {
  const base = ['2026/09/01', '株式会社サンプル商事', 'Webサイト制作', '山田', '150000', '完了'];
  const otherStatus = base.slice(0, 5).concat(['対応中']);
  const otherAmount = base.slice(0, 4).concat(['150001', '完了']);
  const result = classifyRows_([base, otherStatus, otherAmount], ALIAS_MAP, {}, 2);
  assert.equal(result.transfers.length, 3);
  assert.equal(result.duplicates.length, 0);
});

test('振り分け：空行は無視し、要確認データは削除せず元の入力値のまま理由付きで残す', () => {
  const reviewRow = ['2026/09/05', '', 'チラシ作成', '佐藤', '30000', '受付'];
  const result = classifyRows_([['', '', '', '', '', ''], reviewRow], ALIAS_MAP, {}, 2);
  assert.equal(result.transfers.length, 0);
  assert.deepEqual(result.reviews, [{ rowNumber: 3, raw: reviewRow, reasons: ['顧客名が未入力です'] }]);
  assert.deepEqual(result.rowResults, ['', '要確認']);
});

// ===== 二重転記防止（キー判定） =====

test('二重転記防止：整理済みデータに同じキーがあれば転記せず、転記済みとして数える', () => {
  const row = ['2026/09/01', '株式会社サンプル商事', 'Webサイト制作', '山田', '150000', '完了'];
  const key = buildRecordKey_(cleanOrderRow_(row, ALIAS_MAP).record);
  const existingKeys = {};
  existingKeys[key] = true;

  const result = classifyRows_([row], ALIAS_MAP, existingKeys, 2);
  assert.equal(result.transfers.length, 0);
  assert.equal(result.alreadyTransferredCount, 1);
  assert.deepEqual(result.rowResults, ['転記済み']);
});

test('二重転記防止：キーは整理後の内容から作られ、表記ゆれの違いでは変わらない', () => {
  const a = cleanOrderRow_(['2026/9/4', '株式会社デモ物産', 'ＨＰ制作', '鈴木', '300,000', '受付済'], ALIAS_MAP).record;
  const b = cleanOrderRow_(['2026-09-04', '株式会社デモ物産', 'Webサイト制作', 'スズキ', 300000, '受付'], ALIAS_MAP).record;
  assert.equal(buildRecordKey_(a), buildRecordKey_(b));
  assert.equal(buildRecordKey_(a), '["2026-09-04","株式会社デモ物産","Webサイト制作","鈴木",300000,"受付"]');
});

// ===== 集計 =====

test('集計：総件数・売上合計・担当者別・ステータス別を集計する', () => {
  const records = [
    [dateOf(2026, 9, 1), 'A社', 'Webサイト制作', '山田', 150000, '完了'],
    [dateOf(2026, 9, 2), 'B社', 'ロゴデザイン', '佐藤', 50000, '対応中'],
    [dateOf(2026, 9, 3), 'C社', '名刺デザイン', '山田', 20000, '対応中'],
    [dateOf(2026, 9, 4), 'D社', 'チラシ作成', '鈴木', 35000, '受付']
  ];
  const summary = aggregateSummary_(records);
  assert.equal(summary.totalCount, 4);
  assert.equal(summary.totalAmount, 255000);
  assert.deepEqual(summary.byStaff, [
    { name: '山田', count: 2, amount: 170000 },
    { name: '佐藤', count: 1, amount: 50000 },
    { name: '鈴木', count: 1, amount: 35000 }
  ]);
  assert.deepEqual(summary.byStatus, [
    { name: '完了', count: 1 },
    { name: '対応中', count: 2 },
    { name: '受付', count: 1 }
  ]);
  // 担当者別の合計は全体と一致する
  assert.equal(summary.byStaff.reduce((sum, s) => sum + s.amount, 0), summary.totalAmount);
  assert.equal(summary.byStatus.reduce((sum, s) => sum + s.count, 0), summary.totalCount);
});

test('集計：データが0件でもエラーにならない', () => {
  const summary = aggregateSummary_([]);
  assert.deepEqual(summary, { totalCount: 0, totalAmount: 0, byStaff: [], byStatus: [] });
  const values = buildSummaryValues_(summary, '2026/10/05 12:00');
  assert.ok(values.every((line) => line.length === 3));
});

test('集計シートの表：3列の表として出力する', () => {
  const values = buildSummaryValues_({
    totalCount: 2,
    totalAmount: 70000,
    byStaff: [{ name: '山田', count: 2, amount: 70000 }],
    byStatus: [{ name: '完了', count: 2 }]
  }, '2026/10/05 12:00');
  assert.deepEqual(values, [
    ['受注データ集計', '', ''],
    ['最終更新', '2026/10/05 12:00', ''],
    ['', '', ''],
    ['総受注件数', 2, ''],
    ['売上合計', 70000, ''],
    ['', '', ''],
    ['担当者別', '件数', '売上'],
    ['山田', 2, 70000],
    ['', '', ''],
    ['ステータス別', '件数', ''],
    ['完了', 2, '']
  ]);
});

// ===== 完了メッセージ =====

test('完了メッセージ：正常処理・要確認・重複除外の件数を表示する', () => {
  const message = buildCompletionMessage_({
    transfers: [{}, {}, {}],
    reviews: [{}],
    duplicates: [{}, {}],
    alreadyTransferredCount: 0
  });
  assert.match(message, /正常処理（整理済みデータへ新規転記）：3件/);
  assert.match(message, /要確認：1件/);
  assert.match(message, /重複除外：2件/);
  assert.doesNotMatch(message, /転記済みのためスキップ/);
  assert.match(message, /「要確認」シート/);
});

test('完了メッセージ：再実行時は転記済みでスキップした件数も表示する', () => {
  const message = buildCompletionMessage_({ transfers: [], reviews: [], duplicates: [], alreadyTransferredCount: 6 });
  assert.match(message, /正常処理（整理済みデータへ新規転記）：0件/);
  assert.match(message, /転記済みのためスキップ：6件/);
  assert.doesNotMatch(message, /「要確認」シート/);
});
