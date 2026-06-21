// OData client — побайтовый порт Smart\OData\Client (web/src/OData/Client.php).
//
// КРИТИЧНО: percent-кодирование URL в 1С:Fresh чувствительно к каждому байту.
// PHP-оригинал работает над БАЙТАМИ строки ($value[$i] = байт, strlen = байты,
// rawurlencode над UTF-8 последовательностью). В Node строки — UTF-16, поэтому
// здесь мы переводим строку в UTF-8 Buffer и сканируем её ПОБАЙТНО, в точности
// повторяя логику PHP. Любое отличие в кодировании → 1С вернёт 0 строк или 400.

import { Buffer } from 'node:buffer';

export class OdataError extends Error {}

/**
 * Аналог PHP rawurlencode для произвольной последовательности БАЙТОВ.
 * RFC 3986: не кодируются только A-Z a-z 0-9 - _ . ~ ; всё остальное → %XX
 * (шестнадцатеричные цифры в ВЕРХНЕМ регистре). Принимает Buffer (байты).
 */
function rawurlencodeBytes(bytes) {
  let out = '';
  for (const b of bytes) {
    const isUnreserved =
      (b >= 0x41 && b <= 0x5a) || // A-Z
      (b >= 0x61 && b <= 0x7a) || // a-z
      (b >= 0x30 && b <= 0x39) || // 0-9
      b === 0x2d || // -
      b === 0x5f || // _
      b === 0x2e || // .
      b === 0x7e;   // ~
    if (isUnreserved) {
      out += String.fromCharCode(b);
    } else {
      out += '%' + b.toString(16).toUpperCase().padStart(2, '0');
    }
  }
  return out;
}

export class Client {
  /**
   * @param {string} baseUrl
   * @param {string} userpwd  "user:pass" (как CURLOPT_USERPWD)
   * @param {object} opts {connectTimeout, timeout, pageSize}
   */
  constructor(baseUrl, userpwd, opts = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.userpwd = userpwd;
    this.connectTimeout = opts.connectTimeout ?? 10; // секунды
    this.timeout = opts.timeout ?? 60; // секунды
    this.pageSize = opts.pageSize ?? 1000;
  }

  buildUrl(path, query) {
    const encodedPath = this.encodePath(path);
    let url = this.baseUrl + '/odata/standard.odata/' + encodedPath;

    const parts = [];
    // Порядок ключей — порядок вставки (как PHP foreach по массиву).
    for (const name of Object.keys(query)) {
      parts.push(name + '=' + this.encodeValue(String(query[name])));
    }

    if (parts.length > 0) {
      url += '?' + parts.join('&');
    }
    return url;
  }

  async getCollection(path, query) {
    const rows = [];
    let skip = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const pageQuery = { ...query };
      pageQuery['$top'] = String(this.pageSize);
      pageQuery['$skip'] = String(skip);

      const url = this.buildUrl(path, pageQuery);
      const page = await this.fetchValue(url);

      for (const row of page) {
        rows.push(row);
      }

      if (page.length < this.pageSize) {
        break;
      }
      skip += this.pageSize;
    }

    return rows;
  }

  async callFunction(path, query) {
    const url = this.buildUrl(path, query);
    return this.fetchValue(url);
  }

  /** Один GET → разбор JSON → извлечение value (массив). */
  async fetchValue(url) {
    const response = await this.request(url);
    let data;
    try {
      data = JSON.parse(response.body);
    } catch (e) {
      throw new OdataError('OData response missing value array');
    }
    if (data === null || typeof data !== 'object' || !Array.isArray(data.value)) {
      throw new OdataError('OData response missing value array');
    }
    return data.value;
  }

  /**
   * GET с Basic-auth (CURLOPT_USERPWD → Authorization: Basic base64).
   * Ретрай 1 раз на 5xx/сетевую ошибку; 4xx — без ретрая (бросаем сразу).
   */
  async request(url) {
    let attempt = 0;
    const auth = 'Basic ' + Buffer.from(this.userpwd, 'utf8').toString('base64');

    // eslint-disable-next-line no-constant-condition
    while (true) {
      let retriable = false;
      let lastError = '';
      try {
        const controller = new AbortController();
        // CURLOPT_TIMEOUT — общий таймаут запроса (секунды → мс).
        const timer = setTimeout(() => controller.abort(), this.timeout * 1000);
        let res;
        try {
          res = await fetch(url, {
            method: 'GET',
            headers: {
              Authorization: auth,
              Accept: 'application/json',
            },
            signal: controller.signal,
            redirect: 'follow',
          });
        } finally {
          clearTimeout(timer);
        }

        const status = res.status;
        const body = await res.text();

        if (status >= 200 && status < 300) {
          return { status, body };
        }
        if (status >= 400 && status < 500) {
          // 4xx — финально, без ретрая.
          throw new OdataError('OData HTTP ' + status);
        }
        // 5xx (и прочие не-2xx, не-4xx) — ретриабельно.
        retriable = true;
        lastError = 'OData HTTP ' + status;
      } catch (e) {
        if (e instanceof OdataError) {
          // 4xx и финальные ошибки пробрасываются без ретрая.
          throw e;
        }
        // Сетевая ошибка/таймаут — ретриабельно.
        retriable = true;
        lastError = e && e.message ? e.message : String(e);
      }

      if (retriable && attempt < 1) {
        attempt++;
        await sleep(1000);
        continue;
      }
      throw new OdataError('OData request failed: ' + lastError);
    }
  }

  encodePath(path) {
    const segments = path.split('/');
    for (let i = 0; i < segments.length; i++) {
      segments[i] = this.encodeToken(segments[i]);
    }
    return segments.join('/');
  }

  /**
   * Кодирует значение параметра запроса: пробелы → %20, кириллица → percent,
   * сохраняя guid'...'/datetime'...' литералы, запятые и одинарные кавычки.
   * Работает над БАЙТАМИ (UTF-8), как PHP-оригинал.
   */
  encodeValue(value) {
    const bytes = Buffer.from(value, 'utf8');
    let out = '';
    const len = bytes.length;
    let i = 0;

    while (i < len) {
      const ch = bytes[i];

      if (ch === 0x20 /* ' ' */) {
        out += '%20';
        i++;
        continue;
      }
      if (ch === 0x2c /* ',' */) {
        out += ',';
        i++;
        continue;
      }
      if (ch === 0x27 /* "'" */) {
        if (isTypedLiteralPrefix(out)) {
          // Типизированный литерал guid'...'/datetime'...': содержимое ASCII,
          // копируем дословно до парной кавычки.
          out += "'";
          i++;
          while (i < len && bytes[i] !== 0x27) {
            out += String.fromCharCode(bytes[i]);
            i++;
          }
          if (i < len) {
            out += "'";
            i++;
          }
          continue;
        }

        // Голый строковый литерал '...': содержимое percent-кодируется,
        // кавычки-разделители сохраняются, экранирование '' остаётся.
        out += "'";
        i++;
        let literal = [];
        while (i < len) {
          if (bytes[i] === 0x27) {
            if (i + 1 < len && bytes[i + 1] === 0x27) {
              out += this.encodeLiteralBytes(Buffer.from(literal));
              literal = [];
              out += "''";
              i += 2;
              continue;
            }
            break; // закрывающая кавычка
          }
          literal.push(bytes[i]);
          i++;
        }
        out += this.encodeLiteralBytes(Buffer.from(literal));
        if (i < len) {
          out += "'";
          i++;
        }
        continue;
      }

      // Накопить токен до следующего пробела/запятой/кавычки и закодировать.
      const token = [];
      while (
        i < len &&
        bytes[i] !== 0x20 &&
        bytes[i] !== 0x2c &&
        bytes[i] !== 0x27
      ) {
        token.push(bytes[i]);
        i++;
      }
      out += this.encodeTokenBytes(Buffer.from(token));
    }

    return out;
  }

  /**
   * Кодирует содержимое голого строкового литерала: пробел → %20,
   * не-ASCII байты → percent. Разбиваем по байту-пробелу (как explode(' ')).
   * @param {Buffer} literal
   */
  encodeLiteralBytes(literal) {
    // Эквивалент explode(' ', $literal) над байтами: разбиваем по 0x20.
    const chunks = [];
    let cur = [];
    for (const b of literal) {
      if (b === 0x20) {
        chunks.push(Buffer.from(cur));
        cur = [];
      } else {
        cur.push(b);
      }
    }
    chunks.push(Buffer.from(cur));
    return chunks.map((c) => this.encodeTokenBytes(c)).join('%20');
  }

  /** encodeToken по строке (для encodePath): переводим в байты и кодируем. */
  encodeToken(token) {
    return this.encodeTokenBytes(Buffer.from(token, 'utf8'));
  }

  /**
   * Посегментно кодирует один токен над БАЙТАМИ: ASCII (кроме пробела) — дословно,
   * пробел → %20, многобайтовые UTF-8 последовательности → rawurlencode.
   * @param {Buffer} bytes
   */
  encodeTokenBytes(bytes) {
    let out = '';
    const len = bytes.length;
    let i = 0;

    while (i < len) {
      const ord = bytes[i];

      if (ord < 128) {
        if (ord === 0x20) {
          out += '%20';
        } else {
          out += String.fromCharCode(ord);
        }
        i++;
        continue;
      }

      // Старт многобайтовой UTF-8 последовательности: собрать целиком и rawurlencode.
      let width;
      if (ord >= 240) {
        width = 4;
      } else if (ord >= 224) {
        width = 3;
      } else if (ord >= 192) {
        width = 2;
      } else {
        width = 1;
      }

      const seq = bytes.subarray(i, i + width);
      out += rawurlencodeBytes(seq);
      i += width;
    }

    return out;
  }
}

/**
 * true, если накопленный вывод заканчивается на имя типа (guid|datetime)
 * непосредственно перед открывающей кавычкой. Регистр не учитывается.
 */
function isTypedLiteralPrefix(out) {
  const lower = out.toLowerCase();
  return lower.slice(-4) === 'guid' || lower.slice(-8) === 'datetime';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
