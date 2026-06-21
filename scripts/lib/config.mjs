// Конфигурация — порт load_config_array() (web/build-data.php) + нужных
// геттеров Smart\Config (web/src/Config.php).
//
// Источник: переменные окружения (CI / GitHub Secrets) либо локальный фолбэк
// ../config.local.php (как в PHP). Логин/пароль НИКОГДА не печатаются.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const SCRIPTS_DIR = dirname(dirname(__filename)); // web/scripts
const WEB_DIR = dirname(SCRIPTS_DIR); // web/  (= __DIR__ из build-data.php)

const REQUIRED = [
  'ODATA_BASE_UNF', 'ODATA_USER_UNF', 'ODATA_PASS_UNF', 'ORG_FILTER_UNF',
  'ODATA_BASE_BUH', 'ODATA_USER_BUH', 'ODATA_PASS_BUH', 'ORG_FILTER_BUH',
];

function ctypeDigit(s) {
  return typeof s === 'string' && s.length > 0 && /^[0-9]+$/.test(s);
}

// filter_var(..., FILTER_VALIDATE_BOOLEAN): true для "1","true","on","yes"
// (без учёта регистра, с trim), иначе false.
function filterBool(v) {
  const s = String(v).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'on' || s === 'yes';
}

/**
 * Собирает массив конфигурации: из окружения (CI) либо из ../config.local.php.
 * Печатает в STDOUT короткую строку об источнике (как PHP).
 * @param {(s:string)=>void} log писатель в STDOUT
 * @returns {Record<string,any>}
 */
export function loadConfigArray(log) {
  let haveEnv = true;
  for (const k of REQUIRED) {
    const v = process.env[k];
    if (v === undefined || v === '') {
      haveEnv = false;
      break;
    }
  }

  if (haveEnv) {
    const arr = {};
    for (const k of REQUIRED) {
      arr[k] = process.env[k];
    }
    // Несекретные параметры — из repo variables с разумными дефолтами.
    const years = process.env.REPORT_YEARS;
    let list;
    if (years !== undefined && years.trim() !== '') {
      list = [];
      for (let piece of years.split(',')) {
        piece = piece.trim();
        if (piece !== '' && ctypeDigit(piece)) {
          list.push(parseInt(piece, 10));
        }
      }
    } else {
      const cur = new Date().getFullYear();
      list = [cur, cur - 1, cur - 2];
    }
    const defaultYear = process.env.REPORT_YEAR;
    arr.REPORT_YEARS = list;
    arr.REPORT_YEAR = (defaultYear !== undefined && ctypeDigit(String(defaultYear)))
      ? parseInt(defaultYear, 10)
      : Math.max(...list);
    arr.CACHE_TTL = intOrDefault(process.env.CACHE_TTL, 21600);
    arr.ODATA_TIMEOUT = intOrDefault(process.env.ODATA_TIMEOUT, 60);
    arr.ODATA_CONNECT_TIMEOUT = intOrDefault(process.env.ODATA_CONNECT_TIMEOUT, 10);
    const grp = process.env.CONTRACT_GROUP_BY_REGNUM;
    arr.CONTRACT_GROUP_BY_REGNUM = (grp === undefined || grp === '')
      ? true
      : filterBool(grp);
    log('конфиг: из переменных окружения\n');
    return arr;
  }

  // Локальный фолбэк: web/config.local.php или ../config.local.php (как PHP).
  const candidates = [
    join(WEB_DIR, 'config.local.php'),
    join(dirname(WEB_DIR), 'config.local.php'),
  ];
  for (const path of candidates) {
    if (existsSync(path)) {
      const cfg = parsePhpConfig(readFileSync(path, 'utf8'));
      if (cfg && typeof cfg === 'object') {
        log('конфиг: локальный (' + basename(dirname(path)) + '/config.local.php)\n');
        return cfg;
      }
    }
  }

  process.stderr.write('конфиг не найден: задайте переменные окружения OData или положите config.local.php\n');
  process.exit(1);
}

function intOrDefault(v, def) {
  // PHP: (int)(getenv(X) ?: default). '' → default; иначе parseInt (как (int)).
  if (v === undefined || v === '') return def;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? 0 : n;
}

/**
 * Минимальный разбор PHP-массива из config.local.php / config.sample.php.
 * Поддерживает плоский `return array( 'KEY' => 'value', ... );` со строковыми
 * значениями (в одинарных кавычках) и целыми/булевыми литералами. Достаточно
 * для формата config.sample.php проекта.
 * @param {string} php
 * @returns {Record<string,any>|null}
 */
function parsePhpConfig(php) {
  // Срезаем построчные комментарии // ... (вне строковых литералов — грубо, но
  // в этом файле комментарии всегда после значения и не содержат '//' в данных).
  const out = {};
  // Ищем пары 'KEY' => <value> ,
  // value: '...'(одинарные кавычки, с экранированием \' ) | true|false | число
  const re = /'((?:[^'\\]|\\.)*)'\s*=>\s*(?:'((?:[^'\\]|\\.)*)'|(true|false)|(-?\d+(?:\.\d+)?))/g;
  let m;
  let found = false;
  while ((m = re.exec(php)) !== null) {
    found = true;
    const key = unescapePhpSingle(m[1]);
    let value;
    if (m[2] !== undefined) {
      value = unescapePhpSingle(m[2]);
    } else if (m[3] !== undefined) {
      value = m[3] === 'true';
    } else {
      value = m[4].includes('.') ? parseFloat(m[4]) : parseInt(m[4], 10);
    }
    out[key] = value;
  }
  return found ? out : null;
}

// PHP single-quoted string: экранируются только \' и \\.
function unescapePhpSingle(s) {
  return s.replace(/\\(['\\])/g, '$1');
}

/**
 * Обёртка-конфиг с геттерами, как Smart\Config. Проверяет обязательные ключи
 * (включая REPORT_YEAR/CACHE_TTL/... — fromArray в PHP их требует).
 */
export class Config {
  constructor(values) {
    this.values = values;
  }

  static fromArray(a) {
    const requiredKeys = [
      'ODATA_BASE_UNF', 'ODATA_USER_UNF', 'ODATA_PASS_UNF', 'ORG_FILTER_UNF',
      'ODATA_BASE_BUH', 'ODATA_USER_BUH', 'ODATA_PASS_BUH', 'ORG_FILTER_BUH',
      'REPORT_YEAR', 'CACHE_TTL', 'ODATA_TIMEOUT', 'ODATA_CONNECT_TIMEOUT',
      'CONTRACT_GROUP_BY_REGNUM',
    ];
    for (const key of requiredKeys) {
      if (!(key in a)) {
        throw new Error('Отсутствует обязательный ключ конфигурации: ' + key);
      }
      const value = a[key];
      if (value === null || value === '') {
        throw new Error('Пустой обязательный ключ конфигурации: ' + key);
      }
    }
    return new Config(a);
  }

  str(key) { return String(this.values[key]); }
  int(key) { return parseInt(this.values[key], 10); }

  odataBaseUnf() { return this.str('ODATA_BASE_UNF'); }
  odataUserpwdUnf() { return this.str('ODATA_USER_UNF') + ':' + this.str('ODATA_PASS_UNF'); }
  orgUnf() { return this.str('ORG_FILTER_UNF'); }

  odataBaseBuh() { return this.str('ODATA_BASE_BUH'); }
  odataUserpwdBuh() { return this.str('ODATA_USER_BUH') + ':' + this.str('ODATA_PASS_BUH'); }
  orgBuh() { return this.str('ORG_FILTER_BUH'); }

  reportYear() { return this.int('REPORT_YEAR'); }

  reportYears() {
    const def = [2026, 2025, 2024];
    const v = this.values.REPORT_YEARS;
    if (!Array.isArray(v)) {
      return def;
    }
    const years = [];
    for (const value of v) {
      const year = parseInt(value, 10) || 0;
      if (year !== 0) {
        years.push(year);
      }
    }
    return years.length === 0 ? def : years;
  }

  cacheTtl() { return this.int('CACHE_TTL'); }
  odataTimeout() { return this.int('ODATA_TIMEOUT'); }
  odataConnectTimeout() { return this.int('ODATA_CONNECT_TIMEOUT'); }
  contractGroupByRegnum() { return Boolean(this.values.CONTRACT_GROUP_BY_REGNUM); }
}
