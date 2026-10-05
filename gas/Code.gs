/**
 * 受注データ 整理・転記・集計ツール
 *
 * 「入力データ」シートの表記がバラバラな受注データを整理し、
 *   - 正常なデータ       → 「整理済みデータ」シートへ転記（追記・二重転記なし）
 *   - 確認が必要なデータ → 「要確認」シートへ理由付きで振り分け
 *   - 整理済みデータ全体 → 「集計」シートを更新
 * する。カスタムメニュー「データ整理」→「整理・転記を実行」から実行する。
 */

// ===== 設定 =====

var SHEET_NAMES = {
  INPUT: '入力データ',
  CLEANED: '整理済みデータ',
  REVIEW: '要確認',
  SUMMARY: '集計',
  ALIASES: '表記ゆれ設定'
};

var INPUT_HEADERS = ['受付日', '顧客名', '商品名', '担当者', '金額', 'ステータス', '処理結果'];
var INPUT_DATA_COLUMNS = 6; // A〜F列が入力項目、G列は処理結果（スクリプトが記入）
var INPUT_RESULT_COLUMN = 7;

var CLEANED_HEADERS = ['受付日', '顧客名', '商品名', '担当者', '金額', 'ステータス', '元の行番号', '転記日時', '取込キー'];
var CLEANED_KEY_COLUMN = 9; // I列：二重転記防止の判定に使う値

var REVIEW_HEADERS = ['元の行番号', '受付日', '顧客名', '商品名', '担当者', '金額', 'ステータス', '要確認の理由'];

var ALIAS_HEADERS = ['対象項目', '入力された表記', '統一後の表記'];
var ALIAS_TARGETS = ['商品名', '担当者', 'ステータス'];

var RESULT_LABELS = {
  TRANSFERRED: '転記済み',
  REVIEW: '要確認',
  DUPLICATE: '重複除外'
};

var FIRST_DATA_ROW = 2; // 1行目はヘッダー
var LOCK_WAIT_MS = 10000;

// 初期設定で作成する架空のサンプルデータ（意図的に表記を揺らしている）
var SAMPLE_INPUT_ROWS = [
  ['2026/09/01', '株式会社サンプル商事', 'Webサイト制作', '山田', '150000', '完了'],
  ['2026-09-02', '  テスト工業株式会社 ', 'ロゴデザイン', '山田 太郎', '¥50,000', '対応中'],
  ['2026年9月3日', 'ｻﾝﾌﾟﾙ企画', '名刺デザイン', 'ｻﾄｳ', '２０，０００円', '受付'],
  ['2026/9/4', '株式会社デモ物産', 'ＨＰ制作', '鈴木', '300,000', '受付済'],
  ['2026-09-02', '  テスト工業株式会社 ', 'ロゴデザイン', '山田 太郎', '¥50,000', '対応中'],
  ['2026/09/05', '', 'チラシ作成', '佐藤', '30000', '受付'],
  ['2026/09/06', 'サンプル食堂', 'チラシ作成', 'すずき', '三万円', '対応中'],
  ['2026/13/01', 'デモ書店', 'ロゴデザイン', '佐藤', '45000', '完了'],
  ['2026.09.08', 'ＡＢＣデザイン事務所', 'ｗｅｂサイト制作', 'ヤマダ', '￥180,000', '完了'],
  ['2026/09/09', '株式会社サンプル商事', '名刺デザイン', '佐藤', '12000', ''],
  ['2026/9/10', 'テスト工業株式会社', 'チラシ作成', '鈴木', ' 35,000 ', '対応中'],
  ['2026/09/02', 'テスト工業株式会社', 'ロゴデザイン', '山田', '50000', '対応中'],
  ['2026/09/11', 'デモ書店', '名刺デザイン', '', '15000', '受付']
];

var SAMPLE_ALIAS_ROWS = [
  ['商品名', 'HP制作', 'Webサイト制作'],
  ['商品名', 'ホームページ制作', 'Webサイト制作'],
  ['商品名', 'WEBサイト制作', 'Webサイト制作'],
  ['担当者', '山田太郎', '山田'],
  ['担当者', 'ヤマダ', '山田'],
  ['担当者', '佐藤花子', '佐藤'],
  ['担当者', 'サトウ', '佐藤'],
  ['担当者', 'すずき', '鈴木'],
  ['担当者', 'スズキ', '鈴木'],
  ['ステータス', '受付済', '受付'],
  ['ステータス', '受付済み', '受付'],
  ['ステータス', '対応済', '完了'],
  ['ステータス', '対応済み', '完了']
];

// ===== メニュー・初期設定 =====

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('データ整理')
    .addItem('整理・転記を実行', 'runDataTransfer')
    .addSeparator()
    .addItem('初期設定（シート・サンプルデータ作成）', 'setupDemoSheets')
    .addToUi();
}

/**
 * 必要なシートを作成する。既にあるシートの内容は変更しない。
 * 「入力データ」「表記ゆれ設定」は新規作成したときだけ架空のサンプルデータを入れる。
 */
function setupDemoSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var input = ss.getSheetByName(SHEET_NAMES.INPUT);
  if (!input) {
    input = ss.insertSheet(SHEET_NAMES.INPUT);
    writeHeader_(input, INPUT_HEADERS);
    // 表記の揺れをそのまま見せるため、入力欄は書式なしテキストにする
    input.getRange(FIRST_DATA_ROW, 1, 500, INPUT_DATA_COLUMNS).setNumberFormat('@');
    input.getRange(FIRST_DATA_ROW, 1, SAMPLE_INPUT_ROWS.length, INPUT_DATA_COLUMNS).setValues(SAMPLE_INPUT_ROWS);
  }

  if (!ss.getSheetByName(SHEET_NAMES.CLEANED)) {
    writeHeader_(ss.insertSheet(SHEET_NAMES.CLEANED), CLEANED_HEADERS);
  }
  if (!ss.getSheetByName(SHEET_NAMES.REVIEW)) {
    writeHeader_(ss.insertSheet(SHEET_NAMES.REVIEW), REVIEW_HEADERS);
  }
  if (!ss.getSheetByName(SHEET_NAMES.SUMMARY)) {
    ss.insertSheet(SHEET_NAMES.SUMMARY);
  }
  if (!ss.getSheetByName(SHEET_NAMES.ALIASES)) {
    var aliases = ss.insertSheet(SHEET_NAMES.ALIASES);
    writeHeader_(aliases, ALIAS_HEADERS);
    aliases.getRange(FIRST_DATA_ROW, 1, SAMPLE_ALIAS_ROWS.length, ALIAS_HEADERS.length).setValues(SAMPLE_ALIAS_ROWS);
  }

  SpreadsheetApp.getUi().alert('初期設定が完了しました。メニュー「データ整理」→「整理・転記を実行」で処理できます。');
}

function writeHeader_(sheet, headers) {
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  sheet.setFrozenRows(1);
}

// ===== メイン処理 =====

/**
 * カスタムメニュー「整理・転記を実行」から呼び出す関数。
 */
function runDataTransfer() {
  var ui = SpreadsheetApp.getUi();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) {
    ui.alert('別の整理・転記処理が実行中です。しばらく待ってから再度実行してください。');
    return;
  }

  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var input = ss.getSheetByName(SHEET_NAMES.INPUT);
    if (!input) {
      ui.alert('「' + SHEET_NAMES.INPUT + '」シートがありません。メニューの「初期設定」を実行してください。');
      return;
    }
    var headerError = checkInputHeader_(input.getRange(1, 1, 1, INPUT_DATA_COLUMNS).getValues()[0]);
    if (headerError) {
      ui.alert(headerError);
      return;
    }

    var cleaned = getOrCreateSheet_(ss, SHEET_NAMES.CLEANED, CLEANED_HEADERS);
    var review = getOrCreateSheet_(ss, SHEET_NAMES.REVIEW, REVIEW_HEADERS);
    var summarySheet = getOrCreateSheet_(ss, SHEET_NAMES.SUMMARY, null);

    var inputRows = readDataRows_(input, INPUT_DATA_COLUMNS);
    var aliasMap = buildAliasMap_(readAliasRows_(ss));
    var existingKeys = readExistingKeys_(cleaned);

    var result = classifyRows_(inputRows, aliasMap, existingKeys, FIRST_DATA_ROW);

    // 1. 整理済みデータへ追記（新規分のみ）
    if (result.transfers.length > 0) {
      var now = new Date();
      var startRow = Math.max(cleaned.getLastRow(), 1) + 1;
      var newRows = result.transfers.map(function (t) {
        return t.record.concat([t.rowNumber, now, t.key]);
      });
      cleaned.getRange(startRow, 1, newRows.length, CLEANED_HEADERS.length).setValues(newRows);
      cleaned.getRange(startRow, 1, newRows.length, 1).setNumberFormat('yyyy/mm/dd');
      cleaned.getRange(startRow, 5, newRows.length, 1).setNumberFormat('#,##0');
      cleaned.getRange(startRow, 8, newRows.length, 1).setNumberFormat('yyyy/mm/dd hh:mm');
    }

    // 2. 要確認シートを作り直す（現在の入力データで確認が必要な行だけを表示）
    review.clearContents();
    var reviewValues = [REVIEW_HEADERS].concat(result.reviews.map(function (r) {
      return [r.rowNumber].concat(r.raw, [r.reasons.join('／')]);
    }));
    review.getRange(1, 1, reviewValues.length, REVIEW_HEADERS.length).setValues(reviewValues);

    // 3. 入力データのG列に処理結果を記入
    if (result.rowResults.length > 0) {
      input.getRange(FIRST_DATA_ROW, INPUT_RESULT_COLUMN, result.rowResults.length, 1)
        .setValues(result.rowResults.map(function (label) { return [label]; }));
    }

    // 4. 整理済みデータ全体から集計シートを更新
    var summary = aggregateSummary_(readDataRows_(cleaned, INPUT_DATA_COLUMNS));
    var updatedAt = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'yyyy/MM/dd HH:mm');
    var summaryValues = buildSummaryValues_(summary, updatedAt);
    summarySheet.clearContents();
    summarySheet.getRange(1, 1, summaryValues.length, 3).setValues(summaryValues);
    summarySheet.getRange(4, 2, summaryValues.length - 3, 2).setNumberFormat('#,##0');

    ui.alert(buildCompletionMessage_(result));
  } finally {
    lock.releaseLock();
  }
}

function getOrCreateSheet_(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (headers) {
      writeHeader_(sheet, headers);
    }
  }
  return sheet;
}

function readDataRows_(sheet, numColumns) {
  var lastRow = sheet.getLastRow();
  if (lastRow < FIRST_DATA_ROW) {
    return [];
  }
  return sheet.getRange(FIRST_DATA_ROW, 1, lastRow - FIRST_DATA_ROW + 1, numColumns).getValues();
}

function readAliasRows_(ss) {
  var sheet = ss.getSheetByName(SHEET_NAMES.ALIASES);
  return sheet ? readDataRows_(sheet, ALIAS_HEADERS.length) : [];
}

function readExistingKeys_(cleanedSheet) {
  var keys = {};
  var lastRow = cleanedSheet.getLastRow();
  if (lastRow < FIRST_DATA_ROW) {
    return keys;
  }
  cleanedSheet.getRange(FIRST_DATA_ROW, CLEANED_KEY_COLUMN, lastRow - FIRST_DATA_ROW + 1, 1).getValues()
    .forEach(function (line) {
      if (line[0] !== '') {
        keys[String(line[0])] = true;
      }
    });
  return keys;
}

function checkInputHeader_(headerRow) {
  for (var i = 0; i < INPUT_DATA_COLUMNS; i++) {
    if (normalizeText_(headerRow[i]) !== INPUT_HEADERS[i]) {
      return '「' + SHEET_NAMES.INPUT + '」シートの1行目は「' + INPUT_HEADERS.slice(0, INPUT_DATA_COLUMNS).join('・') +
        '」の順に並べてください（' + (i + 1) + '列目が「' + INPUT_HEADERS[i] + '」ではありません）。';
    }
  }
  return '';
}

// ===== データ整理（シートに依存しない純粋な処理） =====

/**
 * 文字列の表記を整える。
 * 全角英数字・全角記号・全角スペースを半角に、半角カタカナを全角に統一し（NFKC正規化）、
 * 前後の空白を削除して、連続する空白を1つにまとめる。
 */
function normalizeText_(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).normalize('NFKC').replace(/\s+/g, ' ').trim();
}

function isBlankRow_(row) {
  for (var i = 0; i < INPUT_DATA_COLUMNS; i++) {
    if (normalizeText_(row[i]) !== '') {
      return false;
    }
  }
  return true;
}

/**
 * 表記ゆれ照合用のキー（空白を除き、英字は小文字にする）。
 */
function toAliasKey_(value) {
  return normalizeText_(value).replace(/ /g, '').toLowerCase();
}

/**
 * 「表記ゆれ設定」シートの行から { 対象項目: { 照合キー: 統一後の表記 } } を作る。
 */
function buildAliasMap_(aliasRows) {
  var map = {};
  ALIAS_TARGETS.forEach(function (target) {
    map[target] = {};
  });
  aliasRows.forEach(function (row) {
    var target = normalizeText_(row[0]);
    var from = toAliasKey_(row[1]);
    var to = normalizeText_(row[2]);
    if (map[target] && from && to) {
      map[target][from] = to;
    }
  });
  return map;
}

function applyAlias_(value, aliasMap, target) {
  var text = normalizeText_(value);
  var table = aliasMap[target] || {};
  var key = toAliasKey_(text);
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : text;
}

/**
 * 受付日を日付（時刻なし）に変換する。変換できない場合は null。
 * 対応形式：スプレッドシートの日付、2026/9/1・2026-09-01・2026.9.1・2026年9月1日・20260901（全角数字も可）
 */
function parseOrderDate_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]') {
    if (isNaN(value.getTime())) {
      return null;
    }
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  if (typeof value === 'number') {
    value = String(value); // 20260901 が数値として入力された場合
  }
  if (typeof value !== 'string') {
    return null;
  }
  var text = normalizeText_(value).replace(/ /g, '');
  var match = text.match(/^(\d{4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})日?$/) || text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!match) {
    return null;
  }
  var year = Number(match[1]);
  var month = Number(match[2]);
  var day = Number(match[3]);
  var date = new Date(year, month - 1, day);
  // 2026/13/01 や 2026/2/30 のような存在しない日付を除外する
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date;
}

/**
 * 金額を0以上の整数に変換する。変換できない場合は null。
 * 「¥」「￥」「円」「,」（全角含む）と空白を取り除いてから判定する。
 */
function parseAmount_(value) {
  if (typeof value === 'number') {
    return isFinite(value) && value >= 0 && Math.floor(value) === value ? value : null;
  }
  var text = normalizeText_(value).replace(/[¥\\,円 ]/g, '');
  if (!/^\d+$/.test(text)) {
    return null;
  }
  return Number(text);
}

/**
 * 入力1行分を整理する。
 * 戻り値: { record: [受付日, 顧客名, 商品名, 担当者, 金額, ステータス], errors: [要確認の理由...] }
 */
function cleanOrderRow_(row, aliasMap) {
  var errors = [];

  var date = null;
  if (normalizeText_(row[0]) === '') {
    errors.push('受付日が未入力です');
  } else {
    date = parseOrderDate_(row[0]);
    if (!date) {
      errors.push('受付日が不正です（入力値: ' + displayValue_(row[0]) + '）');
    }
  }

  var customer = normalizeText_(row[1]);
  if (customer === '') {
    errors.push('顧客名が未入力です');
  }

  var product = applyAlias_(row[2], aliasMap, '商品名');
  if (product === '') {
    errors.push('商品名が未入力です');
  }

  var staff = applyAlias_(row[3], aliasMap, '担当者');
  if (staff === '') {
    errors.push('担当者が未入力です');
  }

  var amount = null;
  if (normalizeText_(row[4]) === '') {
    errors.push('金額が未入力です');
  } else {
    amount = parseAmount_(row[4]);
    if (amount === null) {
      errors.push('金額を数値に変換できません（入力値: ' + displayValue_(row[4]) + '）');
    }
  }

  var status = applyAlias_(row[5], aliasMap, 'ステータス');
  if (status === '') {
    errors.push('ステータスが未入力です');
  }

  return { record: [date, customer, product, staff, amount, status], errors: errors };
}

function displayValue_(value) {
  return normalizeText_(value);
}

/**
 * 整理後の1件を表すキー。整理後の内容が完全に一致するデータは同じキーになる。
 * 「整理済みデータ」シートのI列に保存し、二重転記の判定に使う。
 */
function buildRecordKey_(record) {
  var date = record[0];
  var dateText = date.getFullYear() + '-' + pad2_(date.getMonth() + 1) + '-' + pad2_(date.getDate());
  return JSON.stringify([dateText, record[1], record[2], record[3], record[4], record[5]]);
}

function pad2_(n) {
  return (n < 10 ? '0' : '') + n;
}

/**
 * 入力データ全体を「新規転記」「転記済み」「要確認」「重複除外」に振り分ける。
 *
 * rows         : 入力データのA〜F列（ヘッダーを除く）
 * existingKeys : 整理済みデータに既に転記されているキーの集合
 * firstRowNumber : rows[0] のシート上の行番号
 */
function classifyRows_(rows, aliasMap, existingKeys, firstRowNumber) {
  var result = {
    transfers: [],
    reviews: [],
    duplicates: [],
    alreadyTransferredCount: 0,
    rowResults: []
  };
  var seenInThisRun = {};

  rows.forEach(function (row, index) {
    var rowNumber = firstRowNumber + index;
    if (isBlankRow_(row)) {
      result.rowResults.push('');
      return;
    }

    var cleaned = cleanOrderRow_(row, aliasMap);
    if (cleaned.errors.length > 0) {
      result.reviews.push({ rowNumber: rowNumber, raw: row.slice(0, INPUT_DATA_COLUMNS), reasons: cleaned.errors });
      result.rowResults.push(RESULT_LABELS.REVIEW);
      return;
    }

    var key = buildRecordKey_(cleaned.record);
    if (Object.prototype.hasOwnProperty.call(seenInThisRun, key)) {
      var originalRow = seenInThisRun[key];
      result.duplicates.push({ rowNumber: rowNumber, duplicateOf: originalRow });
      result.rowResults.push(RESULT_LABELS.DUPLICATE + '（' + originalRow + '行目と同じ内容）');
      return;
    }
    seenInThisRun[key] = rowNumber;

    if (Object.prototype.hasOwnProperty.call(existingKeys, key)) {
      result.alreadyTransferredCount++;
    } else {
      result.transfers.push({ rowNumber: rowNumber, record: cleaned.record, key: key });
    }
    result.rowResults.push(RESULT_LABELS.TRANSFERRED);
  });

  return result;
}

// ===== 集計 =====

/**
 * 整理済みデータ（A〜F列）から集計する。担当者・ステータスはデータに登場した順に並べる。
 */
function aggregateSummary_(records) {
  var summary = { totalCount: 0, totalAmount: 0, byStaff: [], byStatus: [] };
  var staffIndex = {};
  var statusIndex = {};

  records.forEach(function (row) {
    var staff = String(row[3]);
    var amount = Number(row[4]);
    var status = String(row[5]);
    if (staff === '' && status === '') {
      return;
    }

    summary.totalCount++;
    summary.totalAmount += amount;

    if (!Object.prototype.hasOwnProperty.call(staffIndex, staff)) {
      staffIndex[staff] = summary.byStaff.length;
      summary.byStaff.push({ name: staff, count: 0, amount: 0 });
    }
    summary.byStaff[staffIndex[staff]].count++;
    summary.byStaff[staffIndex[staff]].amount += amount;

    if (!Object.prototype.hasOwnProperty.call(statusIndex, status)) {
      statusIndex[status] = summary.byStatus.length;
      summary.byStatus.push({ name: status, count: 0 });
    }
    summary.byStatus[statusIndex[status]].count++;
  });

  return summary;
}

/**
 * 集計シートに書き込む値（3列の2次元配列）を作る。
 */
function buildSummaryValues_(summary, updatedAt) {
  var values = [
    ['受注データ集計', '', ''],
    ['最終更新', updatedAt, ''],
    ['', '', ''],
    ['総受注件数', summary.totalCount, ''],
    ['売上合計', summary.totalAmount, ''],
    ['', '', ''],
    ['担当者別', '件数', '売上']
  ];
  summary.byStaff.forEach(function (s) {
    values.push([s.name, s.count, s.amount]);
  });
  values.push(['', '', '']);
  values.push(['ステータス別', '件数', '']);
  summary.byStatus.forEach(function (s) {
    values.push([s.name, s.count, '']);
  });
  return values;
}

function buildCompletionMessage_(result) {
  var lines = [
    '整理・転記が完了しました。',
    '',
    '正常処理（整理済みデータへ新規転記）：' + result.transfers.length + '件',
    '要確認：' + result.reviews.length + '件',
    '重複除外：' + result.duplicates.length + '件'
  ];
  if (result.alreadyTransferredCount > 0) {
    lines.push('転記済みのためスキップ：' + result.alreadyTransferredCount + '件');
  }
  if (result.reviews.length > 0) {
    lines.push('');
    lines.push('要確認のデータは「' + SHEET_NAMES.REVIEW + '」シートで理由を確認し、入力データを修正してから再実行してください。');
  }
  return lines.join('\n');
}
