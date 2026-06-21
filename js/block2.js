/*!
 * block2.js — Экономика (за год / все года).
 *
 *   - 5 KPI: Доход (по отгрузке) / Расход / Прибыль / Рентабельность / Дебиторка;
 *   - линейный график (Прибыль зелёная) — drawBlock2Chart;
 *   - сворачиваемая секция «Сверка с ОФР» (только для конкретного года) — ofr.js;
 *   - клиентская перерисовка при смене года — rerenderBlock2.
 */
import { MONEY_SUFFIX, THINSP, esc, formatRub, formatPercent } from './format.js';
import { C, CHART_READY, destroyExisting, lineConfig, showChartFallback } from './charts.js';
import { yearEconomics } from './aggregate.js';
import { headingHtml, kpiHtml, yearSelectorHtml } from './block1.js';
import { ofrReconciliationHtml, bindOfrToggle } from './ofr.js';

// ----- HTML Блока 2 -----
export function block2Html(data, yearKey) {
  var reportYears = (data.meta && data.meta.reportYears) ? data.meta.reportYears : [];
  var html = '<section class="sd-block" data-sd-block="b2">';
  var yearLabel = (yearKey === 'all') ? 'все года' : String(yearKey);
  html += headingHtml('2', 'Экономика · ' + yearLabel);
  html += yearSelectorHtml(yearKey, reportYears, 'sd_year_econ');

  var e = yearEconomics(data, yearKey);
  var marginText = (e.margin === null) ? '—' : esc(formatPercent(e.margin)) + THINSP + '%';

  html += '<div class="sd-kpis">';
  html += kpiHtml('Доход (по отгрузке)', esc(formatRub(e.revenue)) + MONEY_SUFFIX);
  html += kpiHtml('Расход', esc(formatRub(e.expense)) + MONEY_SUFFIX);
  html += kpiHtml('Прибыль', esc(formatRub(e.profit)) + MONEY_SUFFIX);
  html += kpiHtml('Рентабельность', marginText);
  html += kpiHtml('Дебиторка', esc(formatRub(e.receivable)) + MONEY_SUFFIX);
  html += '</div>';
  html += '<div class="sd-chart"><canvas data-sd-chart="b2"></canvas></div>';

  // Сворачиваемая секция «Сверка с ОФР» — только для конкретного года.
  if (yearKey !== 'all') {
    html += ofrReconciliationHtml(yearKey, e);
  }

  html += '</section>';
  return html;
}

// ----- Линейный график Блока 2 -----
export function drawBlock2Chart(root, data, state) {
  var canvas = root.querySelector('canvas[data-sd-chart="b2"]');
  if (!canvas) { return; }
  if (!CHART_READY) { showChartFallback(root, 'b2'); return; }
  destroyExisting(canvas);
  var e = yearEconomics(data, state.yearEcon);
  var chart = new C(canvas, lineConfig(e.monthlyRevenue, e.monthlyExpense, e.monthlyProfit));
  canvas.__sdChart = chart;
  state.b2chart = chart;
}

// ----- Перерисовка Блока 2 при смене года (клиентская, без сети) -----
export function rerenderBlock2(root, data, state, bindYearSelectsIn) {
  var section = root.querySelector('[data-sd-block="b2"]');
  if (!section) { return; }
  destroyChartInSection(section);
  var wrapper = document.createElement('div');
  wrapper.innerHTML = block2Html(data, state.yearEcon);
  var fresh = wrapper.firstChild;
  section.parentNode.replaceChild(fresh, section);
  drawBlock2Chart(root, data, state);
  bindYearSelectsIn(fresh, root, data, state);
  bindOfrToggle(fresh);
}

function destroyChartInSection(section) {
  var canvases = section.querySelectorAll('canvas[data-sd-chart]');
  var i;
  for (i = 0; i < canvases.length; i++) { destroyExisting(canvases[i]); }
}
