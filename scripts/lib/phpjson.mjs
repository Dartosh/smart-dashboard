// Сериализатор JSON, побайтно совместимый с PHP
//   json_encode($v, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
//
// Зачем свой, а не JSON.stringify: PHP сохраняет порядок вставки ключей объекта,
// а JS-движок переупорядочивает «целочисленные» строковые ключи ("2024","2110")
// по возрастанию. Снимок содержит такие ключи (years, ofr), поэтому
// порядок-чувствительные объекты приходят как Map, и этот сериализатор пишет
// их в порядке вставки.
//
// Формат PHP JSON_PRETTY_PRINT: отступ 4 пробела, ": " между ключом и значением,
// пустые [] и {} без переноса. Числа — кратчайшая round-trip запись (как PHP
// serialize_precision=-1, что совпадает с Number→String в JS).

const INDENT = '    '; // 4 пробела, как PHP

export function phpJsonEncode(value) {
  return enc(value, 0);
}

function enc(value, depth) {
  if (value === null || value === undefined) {
    return 'null';
  }
  const t = typeof value;
  if (t === 'number') {
    return encNumber(value);
  }
  if (t === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (t === 'string') {
    return encString(value);
  }
  if (Array.isArray(value)) {
    return encArray(value, depth);
  }
  if (value instanceof Map) {
    return encEntries([...value.entries()], depth);
  }
  if (t === 'object') {
    return encEntries(Object.entries(value), depth);
  }
  // Прочее (function/symbol) в снимке не встречается.
  return 'null';
}

function encNumber(n) {
  if (!Number.isFinite(n)) {
    // PHP json_encode для NAN/INF падает; в снимке их нет — отдаём 0 как защита.
    return '0';
  }
  // JS Number→String == кратчайшая round-trip запись == PHP serialize_precision=-1.
  // Целое (в т.ч. 0.0 после round) печатается без дробной части (как PHP).
  return String(n);
}

function encString(s) {
  // JSON_UNESCAPED_UNICODE: не-ASCII остаётся как есть.
  // JSON_UNESCAPED_SLASHES: '/' не экранируется.
  // Экранируем: " \ и управляющие < 0x20 (как стандарт JSON / PHP).
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const ch = s[i];
    switch (ch) {
      case '"': out += '\\"'; break;
      case '\\': out += '\\\\'; break;
      case '\b': out += '\\b'; break;
      case '\f': out += '\\f'; break;
      case '\n': out += '\\n'; break;
      case '\r': out += '\\r'; break;
      case '\t': out += '\\t'; break;
      default:
        if (c < 0x20) {
          out += '\\u' + c.toString(16).padStart(4, '0');
        } else {
          out += ch;
        }
    }
  }
  return out + '"';
}

function encArray(arr, depth) {
  if (arr.length === 0) {
    return '[]';
  }
  const pad = INDENT.repeat(depth + 1);
  const closePad = INDENT.repeat(depth);
  const items = arr.map((v) => pad + enc(v, depth + 1));
  return '[\n' + items.join(',\n') + '\n' + closePad + ']';
}

function encEntries(entries, depth) {
  if (entries.length === 0) {
    return '{}';
  }
  const pad = INDENT.repeat(depth + 1);
  const closePad = INDENT.repeat(depth);
  const items = entries.map(
    ([k, v]) => pad + encString(String(k)) + ': ' + enc(v, depth + 1)
  );
  return '{\n' + items.join(',\n') + '\n' + closePad + '}';
}
