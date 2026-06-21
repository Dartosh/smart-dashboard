// Source\BuhRepository — порт web/src/Source/BuhRepository.php (1С:Бухгалтерия).
//
// Виртуальные таблицы регистра Хозрасчетный (Turnovers/Balance) с инлайн-
// параметрами AccountCondition/Condition; листья плана счетов; разбор ОФР
// из base64-XDTO БЕЗ внешних зависимостей (точечный скан, как DOM-якорь PHP).

import { Buffer } from 'node:buffer';

const REGISTER = 'AccountingRegister_Хозрасчетный';
const CHART = 'ChartOfAccounts_Хозрасчетный';
const REGULATORY_DOC = 'Document_РегламентированныйОтчет';

// Документированный per-year запасной Ref_Key годового ОФР (БО).
const OFR_FALLBACK_REF = {
  2024: 'f7735922-ee07-11ef-9400-fa163e08443c',
};

export class BuhRepository {
  constructor(client, orgGuid) {
    this.client = client;
    this.orgGuid = orgGuid;
  }

  /**
   * Официальный ОФР за год (только для сверки) или null.
   * 2120/2220 в XDTO отрицательные → берём abs; 2200=2110−2120−2210−2220.
   * @param {number} year
   */
  async regulatoryOfr(year) {
    const doc = await this.findRegulatoryDoc(year);
    if (doc === null) {
      return null;
    }

    const base64 = doc.ДанныеОтчета_Base64Data !== undefined
      ? String(doc.ДанныеОтчета_Base64Data) : '';
    if (base64 === '') {
      return null;
    }

    const xml = base64DecodeStrict(base64);
    if (xml === null || xml === '') {
      return null;
    }

    const lines = parseOfrLines(xml);
    if (lines === null) {
      return null;
    }

    const l2110 = lines['2110'] !== undefined ? lines['2110'] : 0.0;
    const l2120 = lines['2120'] !== undefined ? Math.abs(lines['2120']) : 0.0;
    const l2210 = lines['2210'] !== undefined ? Math.abs(lines['2210']) : 0.0;
    const l2220 = lines['2220'] !== undefined ? Math.abs(lines['2220']) : 0.0;
    const l2200 = l2110 - l2120 - l2210 - l2220;

    const period = doc._period !== undefined ? String(doc._period) : '';
    const ref = doc.Ref_Key !== undefined ? String(doc.Ref_Key) : '';

    return {
      '2110': l2110,
      '2120': l2120,
      '2210': l2210,
      '2220': l2220,
      '2200': l2200,
      period,
      ref,
    };
  }

  async findRegulatoryDoc(year) {
    const endIso = year + '-12-31';

    let rows = [];
    try {
      rows = await this.client.getCollection(REGULATORY_DOC, {
        '$format': 'json',
        '$filter': "Организация_Key eq guid'" + this.orgGuid + "'",
      });
    } catch (e) {
      rows = [];
    }

    const candidate = this.pickAnnualOfrRow(rows, endIso);
    if (candidate !== null) {
      return candidate;
    }

    if (OFR_FALLBACK_REF[year] !== undefined) {
      return this.fetchDocByRef(OFR_FALLBACK_REF[year]);
    }
    return null;
  }

  pickAnnualOfrRow(rows, endIso) {
    const periodFields = ['ПериодДо', 'Период', 'ДатаОкончания', 'ДатаКонца', 'Date'];

    for (const row of rows) {
      let period = '';
      for (const field of periodFields) {
        if (row[field] !== undefined && String(row[field]) !== '') {
          period = String(row[field]);
          break;
        }
      }
      if (!period.includes(endIso)) {
        continue;
      }
      if (!payloadHasOfr(row)) {
        continue;
      }
      row._period = period;
      return row;
    }
    return null;
  }

  async fetchDocByRef(ref) {
    let rows;
    try {
      rows = await this.client.getCollection(REGULATORY_DOC, {
        '$format': 'json',
        '$filter': "Ref_Key eq guid'" + ref + "'",
      });
    } catch (e) {
      return null;
    }
    if (rows[0] === undefined || typeof rows[0] !== 'object') {
      return null;
    }
    const row = rows[0];
    const periodFields = ['ПериодДо', 'Период', 'ДатаОкончания', 'ДатаКонца', 'Date'];
    for (const field of periodFields) {
      if (row[field] !== undefined && String(row[field]) !== '') {
        row._period = String(row[field]);
        break;
      }
    }
    return row;
  }

  /**
   * Обороты по листовым счетам за [startIso, endIso). Листья — ИЛИ-перечисление
   * Account_Key eq guid''<L>'' (удвоенные кавычки внутри инлайн-параметра).
   * @param {string[]} accountRefKeys
   */
  async turnovers(accountRefKeys, startIso, endIso) {
    const path = REGISTER + '/Turnovers('
      + 'StartPeriod=' + periodLiteral(startIso) + ','
      + 'EndPeriod=' + periodLiteral(endIso) + ','
      + 'AccountCondition=' + this.accountCondition(accountRefKeys) + ','
      + 'Condition=' + this.orgCondition()
      + ')';
    return this.client.callFunction(path, { '$format': 'json' });
  }

  /** Развёрнутое сальдо на момент periodIso (один параметр Period). */
  async balance(accountRefKeys, periodIso) {
    const path = REGISTER + '/Balance('
      + 'Period=' + periodLiteral(periodIso) + ','
      + 'AccountCondition=' + this.accountCondition(accountRefKeys) + ','
      + 'Condition=' + this.orgCondition()
      + ')';
    return this.client.callFunction(path, { '$format': 'json' });
  }

  /**
   * Листовые счета плана Хозрасчётный с Code, начинающимся на '<codePrefix>.'.
   * Лист = Ref_Key, не встречающийся как Parent_Key. Сортировка по Code.
   * @param {string} codePrefix
   */
  async chartLeafAccounts(codePrefix) {
    const rows = await this.client.getCollection(CHART, {
      '$format': 'json',
      '$select': 'Ref_Key,Code,Parent_Key',
    });

    const parents = {};
    for (const row of rows) {
      if (row.Parent_Key !== undefined) {
        parents[String(row.Parent_Key)] = true;
      }
    }

    const leaves = [];
    const prefixDot = codePrefix + '.';
    for (const row of rows) {
      if (row.Ref_Key === undefined || row.Code === undefined) {
        continue;
      }
      const ref = String(row.Ref_Key);
      const code = String(row.Code);

      if (parents[ref]) {
        continue;
      }
      // strncmp(code, codePrefix+'.', len+1) === 0 → code начинается на 'NN.'
      if (!code.startsWith(prefixDot)) {
        continue;
      }
      leaves.push({ ref, code });
    }

    // Детерминированный порядок — по Code (strcmp = байтовое сравнение).
    leaves.sort((a, b) => strcmp(a.code, b.code));
    return leaves;
  }

  accountCondition(accountRefKeys) {
    const terms = accountRefKeys.map((key) => "Account_Key eq guid''" + key + "''");
    return "'" + terms.join(' or ') + "'";
  }

  orgCondition() {
    return "'Организация_Key eq guid''" + this.orgGuid + "'''";
  }
}

function periodLiteral(iso) {
  return "datetime'" + iso + "T00:00:00'";
}

/** Байтовое сравнение строк, как PHP strcmp (по UTF-8 байтам). */
function strcmp(a, b) {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return Buffer.compare(ba, bb);
}

/**
 * base64_decode($s, true): строгий режим. PHP в strict-режиме игнорирует
 * пробельные символы, но падает на прочих не-алфавитных символах. Возвращает
 * декодированную строку (latin1/бинарь как байты → UTF-8 текст) или null.
 */
function base64DecodeStrict(s) {
  // Уберём пробельные символы (PHP strict их допускает).
  const cleaned = s.replace(/[\r\n\t ]/g, '');
  // Проверка строгого алфавита base64.
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(cleaned)) {
    return null;
  }
  try {
    return Buffer.from(cleaned, 'base64').toString('utf8');
  } catch (e) {
    return null;
  }
}

function payloadHasOfr(row) {
  if (row.ДанныеОтчета_Base64Data === undefined) {
    return false;
  }
  const xml = base64DecodeStrict(String(row.ДанныеОтчета_Base64Data));
  if (xml === null || xml === '') {
    return false;
  }
  const lines = parseOfrLines(xml);
  return lines !== null && lines['2110'] !== undefined;
}

/**
 * Парсит XDTO-XML и достаёт значения строк ОФР по их кодам.
 *
 * Якорь: <Property name="П000100<КОД4>04"> — основная форма (П000100), колонка
 * 04 («за отчётный период»). Вторичная секция П000101… с нулями отсекается
 * самим префиксом. Значение — из дочернего <Value> (любой неймспейс-префикс),
 * иначе из текста самого Property. Первое совпадение по коду выигрывает.
 *
 * Реализация без DOM-зависимостей: точечный скан по строке. Воспроизводит
 * семантику DOMDocument::getElementsByTagName('Property') + propertyValue().
 *
 * @param {string} xml
 * @returns {Record<string,number>|null}
 */
function parseOfrLines(xml) {
  const wanted = { '2110': true, '2120': true, '2210': true, '2220': true, '2100': true, '2200': true };

  // Грубая проверка «XML распарсился» — PHP loadXML возвращал бы false на
  // пустой/битой строке; здесь требуем наличие хотя бы одного тега.
  if (xml.indexOf('<') === -1) {
    return null;
  }

  const result = {};

  // Находим все открывающие теги Property (с возможным неймспейс-префиксом),
  // читаем атрибут name, и если он матчит якорь — ищем дочерний <Value>.
  // <(?:[\w.-]+:)?Property\b[^>]*> — открывающий тег Property.
  const propOpen = /<((?:[A-Za-z0-9_.-]+:)?Property)\b([^>]*)>/g;
  let m;
  while ((m = propOpen.exec(xml)) !== null) {
    const tagName = m[1]; // напр. "Property" или "v8:Property"
    const attrs = m[2];
    const name = getAttr(attrs, 'name');
    if (name === null) {
      continue;
    }
    // /^П000100(\d{4})04$/u
    const am = /^П000100(\d{4})04$/u.exec(name);
    if (am === null) {
      continue;
    }
    const code = am[1];
    if (!wanted[code] || result[code] !== undefined) {
      continue;
    }

    // Содержимое элемента Property: от конца открывающего тега до парного
    // закрывающего </...Property>. Самозакрывающийся тег (<Property .../>)
    // здесь не встречается (у показателя всегда есть содержимое), но на всякий
    // случай обрабатываем.
    const value = propertyValue(xml, propOpen.lastIndex, tagName);
    if (value !== null) {
      result[code] = value;
    }
  }

  return result;
}

/**
 * Значение показателя: из ПЕРВОГО дочернего <Value> (любой префикс) внутри
 * содержимого Property, иначе из всего textContent элемента. null — не число.
 * @param {string} xml исходный XML
 * @param {number} contentStart позиция сразу после открывающего тега Property
 * @param {string} tagName имя открывающего тега (для поиска парного закрытия)
 */
function propertyValue(xml, contentStart, tagName) {
  // Найдём границу содержимого: парный закрывающий тег </tagName> с учётом
  // вложенности одноимённых тегов (Property внутри Property теоретически).
  const localTag = tagName; // точное имя с префиксом
  const close = '</' + localTag + '>';
  // Простой поиск ближайшего </tagName>; вложенные Property в XDTO ОФР не
  // встречаются на этом уровне (показатель — лист с одним Value).
  const end = xml.indexOf(close, contentStart);
  const content = end === -1 ? xml.slice(contentStart) : xml.slice(contentStart, end);

  // Прямой дочерний <Value> (локальное имя 'value', любой неймспейс).
  // DOM брал ПЕРВЫЙ дочерний элемент с localName=value, дающий число.
  const valRe = /<(?:[A-Za-z0-9_.-]+:)?Value\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?Value>/g;
  let vm;
  while ((vm = valRe.exec(content)) !== null) {
    const num = toNumber(stripTags(vm[1]));
    if (num !== null) {
      return num;
    }
  }
  // Фолбэк: textContent самого Property (как PHP $prop->textContent).
  return toNumber(stripTags(content));
}

/** Достаёт значение атрибута name="..." (двойные или одинарные кавычки). */
function getAttr(attrs, attrName) {
  const re = new RegExp(attrName + '\\s*=\\s*"([^"]*)"|' + attrName + "\\s*=\\s*'([^']*)'");
  const m = re.exec(attrs);
  if (m === null) return null;
  const raw = m[1] !== undefined ? m[1] : m[2];
  return decodeXmlEntities(raw);
}

function stripTags(s) {
  // textContent: убираем теги, оставляем текстовые узлы, декодируем сущности.
  return decodeXmlEntities(s.replace(/<[^>]*>/g, ''));
}

function decodeXmlEntities(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&');
}

/**
 * Число из XDTO-текста: точка/запятая как разделитель, пробелы/NBSP —
 * разделители разрядов. Возвращает number или null.
 * Регэксп строго: /^-?\d+(\.\d+)?$/ (как PHP).
 */
function toNumber(raw) {
  const trim = raw.trim();
  if (trim === '') {
    return null;
  }
  let clean = trim.replace(/ /g, '').replace(/ /g, '');
  clean = clean.replace(/,/g, '.');
  if (!/^-?\d+(\.\d+)?$/.test(clean)) {
    return null;
  }
  return parseFloat(clean);
}
