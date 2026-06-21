/*!
 * charts.js — палитра, конфиги Chart.js (doughnut/line/bar), безопасное
 * уничтожение/создание инстансов и текстовый фолбэк, если Chart недоступен.
 *
 * Прибыль — зелёная #16a34a (lineConfig). Поведение байт-в-байт как в монолите.
 */
import { MONTH_LABELS, MONEY_SUFFIX, formatRub, esc } from './format.js';

// Локальная ссылка на конструктор Chart (не доверяем window.Chart после кода хоста).
export var C = window.Chart;
export var CHART_READY = !!(C && C.version && String(C.version).charAt(0) === '4');

// Качественная палитра колец: РАЗНЫЕ оттенки, чтобы соседние секторы различались.
export var PALETTE = ['#2563eb', '#16a34a', '#f59e0b', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#65a30d', '#ea580c', '#0d9488', '#9333ea', '#64748b'];

// ---------------------------------------------------------------------------
// Chart-инстансы: уничтожение/пересоздание (анти-утечка). Порт dashboard.js.
// ---------------------------------------------------------------------------
export function destroyExisting(canvas) {
  if (!canvas) { return; }
  if (C && typeof C.getChart === 'function') {
    var existing = C.getChart(canvas);
    if (existing) { existing.destroy(); return; }
  }
  if (canvas.__sdChart) {
    try { canvas.__sdChart.destroy(); } catch (e) { /* ignore */ }
    canvas.__sdChart = null;
  }
}

export function paletteFor(count) {
  var colors = [], i;
  for (i = 0; i < count; i++) { colors.push(PALETTE[i % PALETTE.length]); }
  return colors;
}

export function doughnutConfig(labels, values, palette) {
  var src = palette && palette.length ? palette : PALETTE;
  var colors = [], i;
  for (i = 0; i < labels.length; i++) { colors.push(src[i % src.length]); }
  return {
    type: 'doughnut',
    data: { labels: labels, datasets: [{ data: values, backgroundColor: colors, borderWidth: 1, borderColor: '#ffffff' }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right' },
        tooltip: { callbacks: { label: function (ctx) { return ctx.label + ': ' + formatRub(ctx.parsed) + MONEY_SUFFIX; } } }
      }
    }
  };
}

// Линейный график доход/расход/прибыль (Прибыль — зелёная #16a34a). Порт lineConfig.
export function lineConfig(revenueArr, expenseArr, profitArr) {
  return {
    type: 'line',
    data: {
      labels: MONTH_LABELS,
      datasets: [
        { label: 'Доход', data: revenueArr, borderColor: '#2f5d9e', backgroundColor: 'rgba(47,93,158,0.10)', tension: 0.25, fill: false },
        { label: 'Расход', data: expenseArr, borderColor: '#c0504d', backgroundColor: 'rgba(192,80,77,0.10)', tension: 0.25, fill: false },
        { label: 'Прибыль', data: profitArr, borderColor: '#16a34a', backgroundColor: 'rgba(22,163,74,0.10)', tension: 0.25, fill: false }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top' },
        tooltip: { callbacks: { label: function (ctx) { return ctx.dataset.label + ': ' + formatRub(ctx.parsed.y) + MONEY_SUFFIX; } } }
      },
      scales: { y: { ticks: { callback: function (value) { return formatRub(value); } } } }
    }
  };
}

// Гистограмма отгрузок. Порт barConfig.
export function barConfig(values) {
  return {
    type: 'bar',
    data: { labels: MONTH_LABELS, datasets: [{ label: 'Отгрузки', data: values, backgroundColor: '#4a7bc8', borderColor: '#2f5d9e', borderWidth: 1, borderRadius: 4, borderSkipped: false }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: function (ctx) { return formatRub(ctx.parsed.y) + MONEY_SUFFIX; } } }
      },
      scales: { y: { ticks: { callback: function (value) { return formatRub(value); } } } }
    }
  };
}

// Если Chart.js не загрузился — заменяем canvas текстовым сообщением (не падаем).
export function showChartFallback(root, tag) {
  var canvas = root.querySelector('canvas[data-sd-chart="' + tag + '"]');
  if (!canvas) { return; }
  var p = document.createElement('p');
  p.className = 'sd-empty';
  p.textContent = 'График недоступен: библиотека Chart.js не загрузилась.';
  if (canvas.parentNode) { canvas.parentNode.replaceChild(p, canvas); }
}
