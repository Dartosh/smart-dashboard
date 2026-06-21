#!/usr/bin/env node
// CI-ЭКСТРАКТОР для статической версии (Bitrix24 / GitHub Pages) — порт
// web/build-data.php на Node (zero-dep, нативный fetch, ES-модули).
//
// Запрашивает живой 1С:Fresh (УНФ + Бухгалтерия) по OData и пишет КОМПАКТНЫЙ
// снимок в data.json (в корне репозитория — там же, где index.html).
//   CI:        node scripts/build-data.mjs   — конфиг из переменных окружения.
//   Локально:  node scripts/build-data.mjs   — конфиг из ../config.local.php.
//
// БЕЗОПАСНОСТЬ: логин/пароль OData берутся ТОЛЬКО из окружения/локального конфига
// и НИКОГДА не печатаются и не попадают в data.json.

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfigArray, Config } from './lib/config.mjs';
import { Client } from './lib/odata.mjs';
import { UnfRepository } from './lib/unf.mjs';
import { BuhRepository } from './lib/buh.mjs';
import { buildData } from './lib/build.mjs';
import { phpJsonEncode } from './lib/phpjson.mjs';

const __filename = fileURLToPath(import.meta.url);
const SCRIPTS_DIR = dirname(__filename); // web/scripts
const WEB_DIR = dirname(SCRIPTS_DIR); // web/  (= __DIR__ из build-data.php)

const stdout = (s) => process.stdout.write(s);
const stderr = (s) => process.stderr.write(s);

/** Путь вывода: --out=<path> | OUT_FILE | data.json (в корне репо = web/). */
function resolveOutFile() {
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--out=')) {
      const p = arg.slice('--out='.length);
      return isAbsolute(p) ? p : resolve(process.cwd(), p);
    }
  }
  if (process.env.OUT_FILE && process.env.OUT_FILE !== '') {
    const p = process.env.OUT_FILE;
    return isAbsolute(p) ? p : resolve(process.cwd(), p);
  }
  return join(WEB_DIR, 'data.json');
}

async function main() {
  const config = Config.fromArray(loadConfigArray(stdout));

  // Живой стек 1С (как render.php/build-data.php).
  const unfClient = new Client(config.odataBaseUnf(), config.odataUserpwdUnf(), {
    connectTimeout: config.odataConnectTimeout(),
    timeout: config.odataTimeout(),
  });
  const buhClient = new Client(config.odataBaseBuh(), config.odataUserpwdBuh(), {
    connectTimeout: config.odataConnectTimeout(),
    timeout: config.odataTimeout(),
  });
  const unf = new UnfRepository(unfClient, config.orgUnf());
  const buh = new BuhRepository(buhClient, config.orgBuh());

  const generatedAt = isoDateC();
  const data = await buildData({ config, unf, buh }, generatedAt);

  const json = phpJsonEncode(data);

  const outFile = resolveOutFile();
  const outDir = dirname(outFile);
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }
  writeFileSync(outFile, json + '\n');

  // Короткая сводка в лог (БЕЗ кред): размер + годы + ключевые суммы.
  // data.years — Map (порядок-чувствительные ключи годов).
  const years = data.years instanceof Map ? [...data.years.keys()] : Object.keys(data.years || {});
  stdout('OK: ' + Buffer.byteLength(json, 'utf8') + ' байт → ' + outFile + '\n');
  stdout('сгенерировано: ' + generatedAt + '\n');
  stdout('контрактов (block1.rows): ' + data.block1.rows.length + '\n');
  for (const y of years) {
    const yr = data.years instanceof Map ? data.years.get(y) : data.years[y];
    const ofr = yr.ofr === null ? 'нет' : 'есть';
    stdout(
      '  ' + y + ': отгрузка=' + f2(yr.shipTotal)
      + ' расход=' + f2(yr.expense)
      + ' ДЗ=' + f2(yr.receivable)
      + ' КЗ=' + f2(yr.payable)
      + ' оплата=' + f2(yr.payTotal)
      + ' нетто=' + f2(yr.revenueNet)
      + ' ОФР=' + ofr + '\n'
    );
  }
}

/** %.2f как printf: фиксировано 2 знака. */
function f2(v) {
  return Number(v).toFixed(2);
}

/** PHP date('c') — ISO8601 с офсетом, напр. 2026-06-21T15:04:35+00:00. */
function isoDateC() {
  const d = new Date();
  const off = -d.getTimezoneOffset(); // минуты к UTC
  const sign = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  const oh = String(Math.floor(abs / 60)).padStart(2, '0');
  const om = String(abs % 60).padStart(2, '0');
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear()
    + '-' + p(d.getMonth() + 1)
    + '-' + p(d.getDate())
    + 'T' + p(d.getHours())
    + ':' + p(d.getMinutes())
    + ':' + p(d.getSeconds())
    + sign + oh + ':' + om;
}

main().catch((e) => {
  stderr('build-data упал: ' + (e && e.stack ? e.stack : String(e)) + '\n');
  process.exit(1);
});
