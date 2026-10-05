'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const GAS_FILE_PATH = path.join(__dirname, '..', 'gas', 'Code.gs');

// gas/Code.gs はGoogle Apps Script用のファイル（module.exports等は持たない）。
// このファイル自体は一切変更せず、そのままNode上で読み込んで実行することで、
// 本番コードと全く同じ実装をテストする。
//
// vm.runInThisContext を使うのは、テスト側の Date / Array 等と同一のグローバル
// （同一レルム）でCode.gsを実行し、assert.deepStrictEqual で結果を比較できるようにするため。
//
// SpreadsheetApp・LockService・Utilities はCode.gsの関数の「内部」でだけ参照されるため、
// createGasEnvironment() でテストごとに簡易な偽物（フェイク）をグローバルに差し替える。
let loaded = false;

function loadGasLogic() {
  if (!loaded) {
    vm.runInThisContext(fs.readFileSync(GAS_FILE_PATH, 'utf8'), { filename: GAS_FILE_PATH });
    loaded = true;
  }

  const names = [
    'normalizeText_', 'buildAliasMap_', 'applyAlias_', 'parseOrderDate_', 'parseAmount_',
    'cleanOrderRow_', 'buildRecordKey_', 'classifyRows_', 'aggregateSummary_',
    'buildSummaryValues_', 'buildCompletionMessage_', 'runDataTransfer', 'setupDemoSheets',
    'SAMPLE_INPUT_ROWS', 'SAMPLE_ALIAS_ROWS', 'SHEET_NAMES', 'INPUT_HEADERS'
  ];
  const exportsObject = {};
  for (const name of names) {
    if (typeof global[name] === 'undefined') {
      throw new Error(
        'gas/Code.gs から "' + name + '" を読み込めませんでした。' +
        '関数名・変数名が変更されていないか確認してください。'
      );
    }
    exportsObject[name] = global[name];
  }
  return exportsObject;
}

/**
 * 2次元配列で値を保持するシートのフェイク。書式設定系のメソッドは何もしない。
 */
class FakeSheet {
  constructor(name, rows) {
    this.name = name;
    this.rows = rows ? rows.map((r) => r.slice()) : [];
  }

  getName() {
    return this.name;
  }

  getLastRow() {
    // 実際のシートと同様、値が入っている最後の行を返す
    for (let r = this.rows.length; r > 0; r--) {
      if (this.rows[r - 1].some((v) => v !== '' && v !== undefined && v !== null)) {
        return r;
      }
    }
    return 0;
  }

  getRange(row, column, numRows = 1, numColumns = 1) {
    const sheet = this;
    const range = {
      getValues() {
        const out = [];
        for (let r = 0; r < numRows; r++) {
          const src = sheet.rows[row - 1 + r] || [];
          const line = [];
          for (let c = 0; c < numColumns; c++) {
            const v = src[column - 1 + c];
            line.push(v === undefined ? '' : v);
          }
          out.push(line);
        }
        return out;
      },
      setValues(values) {
        if (values.length !== numRows || values.some((line) => line.length !== numColumns)) {
          throw new Error('setValues: 範囲と値の行数・列数が一致しません');
        }
        values.forEach((line, r) => line.forEach((v, c) => sheet.setCell(row + r, column + c, v)));
        return range;
      },
      setValue(value) {
        sheet.setCell(row, column, value);
        return range;
      },
      setNumberFormat() { return range; },
      setFontWeight() { return range; },
    };
    return range;
  }

  setCell(row, column, value) {
    while (this.rows.length < row) {
      this.rows.push([]);
    }
    const line = this.rows[row - 1];
    while (line.length < column) {
      line.push('');
    }
    line[column - 1] = value;
  }

  clearContents() {
    this.rows = [];
    return this;
  }

  setFrozenRows() {
    return this;
  }

  /** ヘッダーを除いたデータ行（テストで結果を確認する用） */
  dataRows() {
    return this.rows.slice(1, this.getLastRow());
  }
}

/**
 * GAS環境のフェイクを作り、グローバルに差し替える。
 *
 * options.sheets      : { シート名: 2次元配列（1行目はヘッダー） }
 * options.lockAvailable : false にするとロック取得に失敗する
 */
function createGasEnvironment(options = {}) {
  const sheets = {};
  for (const [name, rows] of Object.entries(options.sheets || {})) {
    sheets[name] = new FakeSheet(name, rows);
  }

  const alerts = [];
  const lockState = { acquired: 0, released: 0 };

  const spreadsheet = {
    getSheetByName: (name) => sheets[name] || null,
    insertSheet: (name) => {
      sheets[name] = new FakeSheet(name);
      return sheets[name];
    },
    getSpreadsheetTimeZone: () => 'Asia/Tokyo',
  };

  global.SpreadsheetApp = {
    getActiveSpreadsheet: () => spreadsheet,
    getUi: () => ({ alert: (message) => alerts.push(String(message)) }),
  };
  global.LockService = {
    getScriptLock: () => ({
      tryLock: () => {
        if (options.lockAvailable === false) {
          return false;
        }
        lockState.acquired++;
        return true;
      },
      releaseLock: () => {
        lockState.released++;
      },
    }),
  };
  global.Utilities = {
    formatDate: () => '2026/10/05 12:00',
  };

  return { sheets, alerts, lockState };
}

module.exports = { loadGasLogic, createGasEnvironment, FakeSheet };
