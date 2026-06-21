// Block1\RegNumber — порт web/src/Block1/RegNumber.php.
//
// КРИТИЧНО: PHP-оригинал работает над БАЙТАМИ (strlen=байты, $s[$i]=байт,
// strrpos=байтовый поиск), а левый контекст режется по СИМВОЛАМ (mb_substr).
// Мы воспроизводим это, держа исходную строку как UTF-8 Buffer и работая с
// байтовыми смещениями; нижний регистр считаем строкой (mb_strtolower) и
// переводим её в байты — для кириллицы и ASCII длина в байтах не меняется,
// поэтому байтовые смещения tokenStart валидны и в lower.

import { Buffer } from 'node:buffer';

const MIN_DIGITS = 11;
const MAX_DIGITS = 19;
const LEFT_CONTEXT_CHARS = 80;

const CONTRACT_MARKERS = ['контракт', 'договор', 'реестров', 'закупк'];
const BANK_TAX_MARKERS = ['р/с', 'к/с', 'инн', 'кпп', 'бик', 'счет', 'счёт'];
// Знак '№' (U+2116) в UTF-8: E2 84 96.
const NUMERO_SIGN = Buffer.from([0xe2, 0x84, 0x96]);

/** Байт ASCII-цифры? */
function isDigitByte(b) {
  return b >= 0x30 && b <= 0x39;
}

export const RegNumber = {
  /**
   * §5.1: извлекает номер закупочного контракта из ОснованиеПечати или null.
   * @param {string} osnovaniePechati
   * @returns {string|null}
   */
  extract(osnovaniePechati) {
    if (osnovaniePechati === '') {
      return null;
    }

    const src = Buffer.from(osnovaniePechati, 'utf8');
    // mb_strtolower по UTF-8; для кириллицы/ASCII сохраняет длину в байтах.
    const lower = Buffer.from(osnovaniePechati.toLowerCase(), 'utf8');

    let best = null;
    let bestLen = 0;
    let bestPos = 0;

    const length = src.length;
    let i = 0;

    while (i < length) {
      const ch = src[i];

      if (!isDigitByte(ch)) {
        i++;
        continue;
      }

      const tokenStart = i;
      let digits = '';
      let j = i;

      while (j < length) {
        const cj = src[j];
        if (isDigitByte(cj)) {
          digits += String.fromCharCode(cj);
          j++;
          continue;
        }
        const sepLen = separatorLength(src, j, length);
        if (sepLen > 0 && nextIsDigit(src, j + sepLen, length)) {
          j += sepLen;
          continue;
        }
        break;
      }

      i = j;

      const digitLen = digits.length;

      if (digitLen < MIN_DIGITS || digitLen > MAX_DIGITS) {
        continue;
      }

      let leftContext = leftContextChars(lower, tokenStart);
      leftContext = clipToCurrentSentence(leftContext);

      let contractPos = nearestMarkerPos(leftContext, CONTRACT_MARKERS);
      const numeroPos = lastPos(leftContext, NUMERO_SIGN);
      if (numeroPos > contractPos) {
        contractPos = numeroPos;
      }

      const hasContractMarker = contractPos >= 0;
      if (!hasContractMarker) {
        continue;
      }

      const bankPos = nearestMarkerPos(leftContext, BANK_TAX_MARKERS);
      if (bankPos > contractPos) {
        continue;
      }

      const prefix = cyrillicPrefixBefore(src, tokenStart);
      const value = prefix + digits;

      if (digitLen > bestLen || (digitLen === bestLen && tokenStart < bestPos)) {
        best = value;
        bestLen = digitLen;
        bestPos = tokenStart;
      }
    }

    return best;
  },

  /**
   * §5.1: реестровый номер ЕИС (18..20 цифр) после маркера «реестр…ном…».
   * Граница (?!\d) запрещает обрезать 21+ цифр до 20.
   * @param {string} text
   * @returns {string|null}
   */
  extractReestr(text) {
    if (text === '') {
      return null;
    }
    // PCRE: /реестр[а-яё.\s]{0,30}ном[а-яё]*[^0-9]{0,40}(\d{18,20})(?!\d)/iu
    // ВАЖНО: PCRE \s по умолчанию ASCII-only (без (*UCP)), а JS \s в u-режиме
    // Unicode-aware (включает NBSP и т.п.). Чтобы совпасть с PHP, заменяем \s
    // на явный ASCII-класс пробелов [ \t\n\r\f\v].
    const re = /реестр[а-яё.\t\n\r\f\v ]{0,30}ном[а-яё]*[^0-9]{0,40}(\d{18,20})(?!\d)/iu;
    const m = re.exec(text);
    return m ? m[1] : null;
  },
};

/**
 * Длина разделителя в БАЙТАХ, если на позиции pos стоит внутренний разделитель
 * номера (пробел/дефис/перенос/таб/NBSP), иначе 0.
 * @param {Buffer} s
 */
function separatorLength(s, pos, length) {
  const c = s[pos];
  if (c === 0x20 || c === 0x2d || c === 0x0a || c === 0x0d || c === 0x09) {
    return 1;
  }
  // NBSP в UTF-8: C2 A0.
  if (c === 0xc2 && pos + 1 < length && s[pos + 1] === 0xa0) {
    return 2;
  }
  return 0;
}

function nextIsDigit(s, pos, length) {
  if (pos >= length) {
    return false;
  }
  return isDigitByte(s[pos]);
}

/**
 * Буквенный префикс процедуры (ОК/ЭК/ЗК) ВПЛОТНУЮ слева от цифр; до 3
 * кириллических букв (ведущий байт 0xD0/0xD1). Возвращает строку префикса.
 * @param {Buffer} s
 */
function cyrillicPrefixBefore(s, digitStart) {
  const maxLetters = 3;
  let start = digitStart;
  let letters = 0;

  while (letters < maxLetters && start >= 2) {
    const lead = s[start - 2];
    if (lead !== 0xd0 && lead !== 0xd1) {
      break;
    }
    start -= 2;
    letters++;
  }

  if (letters === 0) {
    return '';
  }
  return s.subarray(start, digitStart).toString('utf8');
}

/**
 * Последние LEFT_CONTEXT_CHARS СИМВОЛОВ строки lower до байтовой позиции
 * tokenStart (срез по символам, как mb_substr).
 * @param {Buffer} lower
 * @returns {Buffer}
 */
function leftContextChars(lower, tokenStart) {
  const before = lower.subarray(0, tokenStart).toString('utf8');
  // mb_substr($before, -80, null, 'UTF-8'): последние 80 символов.
  const chars = Array.from(before); // по кодпойнтам
  const tail = chars.length > LEFT_CONTEXT_CHARS
    ? chars.slice(chars.length - LEFT_CONTEXT_CHARS)
    : chars;
  return Buffer.from(tail.join(''), 'utf8');
}

/**
 * Хвост контекста после последнего терминатора предложения (. ; ! ?).
 * Терминаторы — ASCII, байтовый поиск корректен.
 * @param {Buffer} context
 * @returns {Buffer}
 */
function clipToCurrentSentence(context) {
  let cut = -1;
  const terminators = [0x2e /* . */, 0x3b /* ; */, 0x21 /* ! */, 0x3f /* ? */];
  for (const t of terminators) {
    const pos = lastIndexOfByte(context, t);
    if (pos !== -1 && pos > cut) {
      cut = pos;
    }
  }
  if (cut < 0) {
    return context;
  }
  return context.subarray(cut + 1);
}

/**
 * Наибольший байтовый offset вхождения любого из маркеров (строк), либо -1.
 * @param {Buffer} haystack
 * @param {string[]} needles
 */
function nearestMarkerPos(haystack, needles) {
  let best = -1;
  for (const needle of needles) {
    const pos = lastPos(haystack, Buffer.from(needle, 'utf8'));
    if (pos > best) {
      best = pos;
    }
  }
  return best;
}

/**
 * Байтовый offset последнего вхождения needle (Buffer) в haystack (Buffer), -1.
 * @param {Buffer} haystack
 * @param {Buffer} needle
 */
function lastPos(haystack, needle) {
  if (needle.length === 0) {
    return -1;
  }
  return haystack.lastIndexOf(needle);
}

function lastIndexOfByte(buf, byte) {
  for (let k = buf.length - 1; k >= 0; k--) {
    if (buf[k] === byte) return k;
  }
  return -1;
}
