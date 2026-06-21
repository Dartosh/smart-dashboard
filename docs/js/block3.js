/*!
 * block3.js — Отгрузки (за год / все года).
 *
 *   - KPI-тройка: Заключённые контракты (за всё время) / Отгрузка / Оплата;
 *   - таблица по месяцам + строка «Итого»;
 *   - гистограмма отгрузок — drawBlock3Chart;
 *   - клиентская перерисовка при смене года — rerenderBlock3;
 *     год Блока 3 управляет диаграммой «По оплате» Блока 1.
 */
import { MONTH_LABELS, MONEY_SUFFIX, esc, formatRub } from './format.js';
import { CHART_READY, C, destroyExisting, barConfig, showChartFallback } from './charts.js';
import { block1Total, yearShipments } from './aggregate.js';
import { headingHtml, kpiHtml, yearSelectorHtml, redrawPayChart } from './block1.js';

// ----- HTML Блока 3 -----
export function block3Html(data, yearKey) {
  var reportYears = (data.meta && data.meta.reportYears) ? data.meta.reportYears : [];
  var rows = (data.block1 && data.block1.rows) ? data.block1.rows : [];
  var s = yearShipments(data, yearKey);

  var html = '<section class="sd-block" data-sd-block="b3">';
  var shipHeading = (yearKey === 'all') ? 'Отгрузки · все года' : 'Отгрузки за ' + String(yearKey);
  html += headingHtml('3', shipHeading);
  html += yearSelectorHtml(yearKey, reportYears, 'sd_year_ship');

  // KPI-тройка: Заключённые контракты (за всё время) / Отгрузка / Оплата.
  var kContracts = block1Total(rows);
  var kpiPeriod = (yearKey === 'all') ? 'за все года' : 'за ' + String(yearKey);
  html += '<div class="sd-kpis">';
  html += kpiHtml('Заключённые контракты', esc(formatRub(kContracts)) + MONEY_SUFFIX + '<span class="sd-kpi-sub">за всё время</span>');
  html += kpiHtml('Отгрузка', esc(formatRub(s.total)) + MONEY_SUFFIX + '<span class="sd-kpi-sub">' + esc(kpiPeriod) + '</span>');
  html += kpiHtml('Оплата', esc(formatRub(s.payTotal)) + MONEY_SUFFIX + '<span class="sd-kpi-sub">' + esc(kpiPeriod) + '</span>');
  html += '</div>';

  var hasData = false, m;
  for (m = 0; m < 12; m++) { if (s.months[m] !== 0) { hasData = true; break; } }

  if (!hasData) {
    html += '<p class="sd-empty">Нет данных за период</p>';
  } else {
    html += '<div class="sd-table-wrap"><table class="sd-tbl"><thead><tr><th>Месяц</th>'
      + '<th class="sd-num">Сумма</th></tr></thead><tbody>';
    for (m = 0; m < 12; m++) {
      var monthCell = (yearKey === 'all') ? MONTH_LABELS[m] : MONTH_LABELS[m] + ' ' + String(yearKey);
      html += '<tr><td>' + esc(monthCell) + '</td>'
        + '<td class="sd-num">' + esc(formatRub(s.months[m])) + MONEY_SUFFIX + '</td></tr>';
    }
    html += '</tbody><tfoot><tr><td>Итого</td>'
      + '<td class="sd-num sd-total">' + esc(formatRub(s.total)) + MONEY_SUFFIX + '</td>'
      + '</tr></tfoot></table></div>';
    html += '<div class="sd-chart-below"><div class="sd-chart"><canvas data-sd-chart="b3"></canvas></div></div>';
  }

  html += '</section>';
  return html;
}

// ----- Гистограмма Блока 3 -----
export function drawBlock3Chart(root, data, state) {
  var canvas = root.querySelector('canvas[data-sd-chart="b3"]');
  if (!canvas) { return; }
  if (!CHART_READY) { showChartFallback(root, 'b3'); return; }
  destroyExisting(canvas);
  var s = yearShipments(data, state.yearShip);
  var chart = new C(canvas, barConfig(s.months));
  canvas.__sdChart = chart;
  state.b3chart = chart;
}

// ----- Перерисовка Блока 3 при смене года (клиентская, без сети) -----
export function rerenderBlock3(root, data, state, bindYearSelectsIn) {
  var section = root.querySelector('[data-sd-block="b3"]');
  if (!section) { return; }
  destroyChartInSection(section);
  var wrapper = document.createElement('div');
  wrapper.innerHTML = block3Html(data, state.yearShip);
  var fresh = wrapper.firstChild;
  section.parentNode.replaceChild(fresh, section);
  drawBlock3Chart(root, data, state);
  bindYearSelectsIn(fresh, root, data, state);
  // Год Блока 3 управляет диаграммой «По оплате» Блока 1 — перерисуем её.
  redrawPayChart(root, data, state);
}

function destroyChartInSection(section) {
  var canvases = section.querySelectorAll('canvas[data-sd-chart]');
  var i;
  for (i = 0; i < canvases.length; i++) { destroyExisting(canvases[i]); }
}
