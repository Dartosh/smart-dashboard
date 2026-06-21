/*!
 * format.js — форматирование (деньги/числа/даты/проценты) и эскейп HTML.
 *
 * Поведение байт-в-байт как в монолитном index.html / Money::rub:
 *   - целые рубли, round half up, NBSP-разделитель тысяч, без знака валюты;
 *   - суффикс валюты MONEY_SUFFIX = тонкий пробел U+2009 + «₽»;
 *   - проценты с 1 знаком и десятичной запятой (Money::percent);
 *   - ISO YYYY-MM-DD -> DD.MM.YYYY (DashboardView::isoToDmy).
 */

// Суффикс валюты: тонкий пробел U+2009 + знак рубля (как DashboardView '&#8201;&#8381;').
export var THINSP = ' ';
export var RUB = '₽';
export var MONEY_SUFFIX = THINSP + RUB;

// Разделитель тысяч — NBSP U+00A0 (как Money::NBSP).
export var NBSP = ' ';

export var MONTH_LABELS = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];

// ---------------------------------------------------------------------------
// Форматирование денег: идентично Money::rub (целые рубли, round half up,
// NBSP-разделитель тысяч, без знака валюты).
// ---------------------------------------------------------------------------
export function formatRub(amount) {
  var n = Number(amount);
  if (!isFinite(n)) { n = 0; }
  var rounded;
  if (n >= 0) { rounded = Math.floor(n + 0.5); }
  else { rounded = -Math.floor(-n + 0.5); }
  var negative = rounded < 0;
  var digits = String(Math.abs(rounded));
  var out = '';
  var count = 0;
  var i;
  for (i = digits.length - 1; i >= 0; i--) {
    out = digits.charAt(i) + out;
    count++;
    if (count % 3 === 0 && i > 0) { out = NBSP + out; }
  }
  return negative ? '-' + out : out;
}

// Сумма с копейками (2 знака, точка) — для таблицы сверки с ОФР (как number_format($,2,'.','')).
export function formatCents(amount) {
  var n = Number(amount);
  if (!isFinite(n)) { n = 0; }
  return n.toFixed(2);
}

// Доля (0.217) -> процент с 1 знаком и десятичной запятой ("21,7"). Как Money::percent.
export function formatPercent(ratio01) {
  var value = Number(ratio01) * 100.0;
  if (!isFinite(value)) { value = 0; }
  var rounded = Math.round(value * 10) / 10;
  var s = rounded.toFixed(1).replace('.', ',');
  if (s === '-0,0') { return '0,0'; }
  return s;
}

// Безопасное число (NaN/Infinity -> 0).
export function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }

// ---------------------------------------------------------------------------
// Эскейп для HTML (как DashboardView::esc — htmlspecialchars ENT_QUOTES).
// ---------------------------------------------------------------------------
export function esc(s) {
  s = (s === undefined || s === null) ? '' : String(s);
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// ISO YYYY-MM-DD -> DD.MM.YYYY (как DashboardView::isoToDmy).
export function isoToDmy(iso) {
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (m) { return m[3] + '.' + m[2] + '.' + m[1]; }
  return esc(String(iso || ''));
}

// Нормализованная ISO-дата YYYY-MM-DD (для data-date, фильтр).
export function isoDate(iso) {
  var m = /^(\d{4}-\d{2}-\d{2})/.exec(String(iso || ''));
  return m ? m[1] : '';
}

// generatedAt (ISO8601) -> "дд.мм.гггг чч:мм" по местному времени браузера.
export function fmtGeneratedAt(iso) {
  var d = new Date(iso);
  if (isNaN(d.getTime())) { return esc(String(iso || '')); }
  function p2(x) { return (x < 10 ? '0' : '') + x; }
  return p2(d.getDate()) + '.' + p2(d.getMonth() + 1) + '.' + d.getFullYear()
       + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
}
