/*!
 * block1.js — Контракты (за всё время).
 *
 *   - таблица 7 столбцов: дата / номер-ссылка (sd-numlink) / реестр (sd-eis-btn|«—»)
 *     / заказчик / ИНН / статус-бейдж / сумма, + строка «Итого»;
 *   - фильтры Год + Статус (порт buildBlock1Filters/applyBlock1Filter);
 *   - две кольцевые диаграммы: «По объёму контрактов» (агрегат rows по inn)
 *     и «По оплате» (payByCustomer года Блока 3).
 *
 * Здесь же — общие HTML-хелперы (headingHtml/kpiHtml/yearSelectorHtml),
 * которые переиспользуют block2.js и block3.js.
 */
import { NBSP, MONEY_SUFFIX, num, esc, isoToDmy, isoDate, formatRub } from './format.js';
import { C, CHART_READY, destroyExisting, paletteFor, doughnutConfig, showChartFallback } from './charts.js';
import { block1Total, block1Statuses, block1ByCustomer, yearEconomics } from './aggregate.js';

// ---------------------------------------------------------------------------
// Общие HTML-хелперы (используются всеми блоками).
// ---------------------------------------------------------------------------
export function headingHtml(numStr, title) {
  return '<h2 class="sd-h"><span class="sd-num">' + esc(numStr) + '</span>' + esc(title) + '</h2>';
}

export function kpiHtml(label, valueHtml) {
  return '<div class="sd-kpi"><div class="sd-kpi-l">' + esc(label) + '</div><div class="sd-kpi-v">' + valueHtml + '</div></div>';
}

export function yearSelectorHtml(selectedYear, reportYears, paramName) {
  if (!reportYears || !reportYears.length) { return ''; }
  var html = '<div class="sd-year"><label>Год:' + NBSP + '<select data-sd-year="' + esc(paramName) + '">';
  var allSel = (selectedYear === 'all') ? ' selected' : '';
  html += '<option value="all"' + allSel + '>Все года</option>';
  var i, y, sel;
  for (i = 0; i < reportYears.length; i++) {
    y = Number(reportYears[i]);
    sel = (Number(selectedYear) === y && selectedYear !== 'all') ? ' selected' : '';
    html += '<option value="' + esc(String(y)) + '"' + sel + '>' + esc(String(y)) + '</option>';
  }
  html += '</select></label></div>';
  return html;
}

// ---------------------------------------------------------------------------
// Бейдж статуса (цвет по ключевому слову; порт DashboardView::statusVariant).
// ---------------------------------------------------------------------------
function statusVariant(status) {
  var s = String(status || '').replace(/^\s+|\s+$/g, '').toLowerCase();
  if (s === '') { return ''; }
  var done = ['закрыт', 'выполнен', 'отгруж', 'завершен', 'завершён', 'исполнен', 'оплачен'];
  var i;
  for (i = 0; i < done.length; i++) { if (s.indexOf(done[i]) !== -1) { return 'sd-done'; } }
  var work = ['в работе', 'на выполнении', 'выставлен', 'в процессе', 'частично'];
  for (i = 0; i < work.length; i++) { if (s.indexOf(work[i]) !== -1) { return 'sd-work'; } }
  var nw = ['не обработан', 'новый', 'черновик', 'создан'];
  for (i = 0; i < nw.length; i++) { if (s.indexOf(nw[i]) !== -1) { return 'sd-new'; } }
  return '';
}

function statusBadge(status) {
  var variant = statusVariant(status);
  var cls = 'sd-badge' + (variant ? ' ' + variant : '');
  var text = String(status || '').replace(/^\s+|\s+$/g, '');
  if (text === '') { text = '—'; }
  return '<span class="' + cls + '">' + esc(text) + '</span>';
}

// Ссылка номера контракта (порт DashboardView): ОК/ЭК/ЗК → mos.ru; 15+ цифр → ЕИС.
function numCellHtml(number) {
  number = String(number || '');
  var url = '';
  if (/^(ОК|ЭК|ЗК)/.test(number)) {
    url = 'https://zakupki.mos.ru/?searchText=' + encodeURIComponent(number);
  } else if (/^\d{15,}$/.test(number)) {
    url = 'https://zakupki.gov.ru/epz/order/extendedsearch/results.html?searchString=' + encodeURIComponent(number);
  }
  if (url) {
    return '<a class="sd-numlink" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(number) + '</a>';
  }
  return esc(number);
}

// Ячейка реестрового номера (порт DashboardView sd-eis-btn).
function reestrCellHtml(reestr) {
  reestr = (reestr === undefined || reestr === null) ? '' : String(reestr);
  if (reestr === '') {
    return '<span class="sd-muted">—</span>';
  }
  var eisUrl = 'https://zakupki.gov.ru/epz/contract/contractCard/common-info.html?reestrNumber=' + encodeURIComponent(reestr);
  return '<a class="sd-eis-btn" href="' + esc(eisUrl) + '"'
    + ' target="_blank" rel="noopener noreferrer" title="Открыть карточку контракта в ЕИС">'
    + '<svg class="sd-eis-ico" width="12" height="12" viewBox="0 0 24 24" fill="none"'
    + ' stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>'
    + '<polyline points="15 3 21 3 21 9"></polyline>'
    + '<line x1="10" y1="14" x2="21" y2="3"></line></svg>'
    + '<span>' + esc(reestr) + '</span></a>';
}

// ---------------------------------------------------------------------------
// HTML Блока 1.
// ---------------------------------------------------------------------------
export function block1Html(data) {
  var rows = (data.block1 && data.block1.rows) ? data.block1.rows : [];
  var html = '<section class="sd-block" data-sd-block="b1">';
  html += headingHtml('1', 'Контракты · за всё время');

  if (!rows.length) {
    html += '<p class="sd-empty">Нет данных за период</p>';
    html += '</section>';
    return html;
  }

  html += '<div class="sd-table-wrap"><table class="sd-tbl sd-tbl-wide"><thead><tr>'
    + '<th>Дата заключения</th><th>Номер контракта</th><th>Реестровый номер</th><th>Заказчик</th><th>ИНН</th>'
    + '<th>Статус</th><th class="sd-num">Сумма</th></tr></thead><tbody>';
  var i, row, amount, iso, status;
  for (i = 0; i < rows.length; i++) {
    row = rows[i];
    amount = num(row.amount);
    iso = String(row.date || '');
    status = String(row.status || '');
    html += '<tr data-date="' + esc(isoDate(iso)) + '" data-status="' + esc(status) + '">'
      + '<td>' + isoToDmy(iso) + '</td>'
      + '<td>' + numCellHtml(row.regnum) + '</td>'
      + '<td>' + reestrCellHtml(row.reestr) + '</td>'
      + '<td>' + esc(String(row.customer || '')) + '</td>'
      + '<td>' + esc(String(row.inn || '')) + '</td>'
      + '<td>' + statusBadge(status) + '</td>'
      + '<td class="sd-num">' + esc(formatRub(amount)) + MONEY_SUFFIX + '</td>'
      + '</tr>';
  }
  html += '</tbody><tfoot><tr><td colspan="6">Итого</td>'
    + '<td class="sd-num sd-total">' + esc(formatRub(block1Total(rows))) + MONEY_SUFFIX + '</td>'
    + '</tr></tfoot></table></div>';
  // Две кольцевые диаграммы под таблицей.
  html += '<div class="sd-chart-below sd-chart-narrow">'
    + '<div class="sd-chart-cap">По объёму контрактов</div>'
    + '<div class="sd-chart"><canvas data-sd-chart="b1"></canvas></div></div>';
  html += '<div class="sd-chart-below sd-chart-narrow">'
    + '<div class="sd-chart-cap">По оплате</div>'
    + '<div class="sd-chart"><canvas data-sd-chart="b1pay"></canvas></div></div>';
  html += '</section>';
  return html;
}

// ---------------------------------------------------------------------------
// ФИЛЬТРЫ БЛОКА 1 (Год + Статус). Порт buildBlock1Filters/applyBlock1Filter.
// ---------------------------------------------------------------------------
export function buildBlock1Filters(root, data, state) {
  var section = root.querySelector('[data-sd-block="b1"]');
  if (!section) { return; }
  var table = section.querySelector('table.sd-tbl');
  if (!table) { return; }
  if (section.querySelector('[data-sd-filters]')) { return; }

  var rows = (data.block1 && data.block1.rows) ? data.block1.rows : [];

  var bar = document.createElement('div');
  bar.className = 'sd-filters';
  bar.setAttribute('data-sd-filters', '1');

  // Статус.
  var statusSelect = document.createElement('select');
  statusSelect.setAttribute('data-sd-filter', 'status');
  var all = document.createElement('option');
  all.value = '__ALL__'; all.textContent = 'Все';
  statusSelect.appendChild(all);
  var statuses = block1Statuses(rows);
  var i, opt;
  for (i = 0; i < statuses.length; i++) {
    opt = document.createElement('option');
    opt.value = String(statuses[i]); opt.textContent = String(statuses[i]);
    statusSelect.appendChild(opt);
  }

  // Год — уникальные годы из rows[].date (YYYY), по убыванию.
  var yearSelect = document.createElement('select');
  yearSelect.setAttribute('data-sd-filter', 'year');
  var allYears = document.createElement('option');
  allYears.value = ''; allYears.textContent = 'Все';
  yearSelect.appendChild(allYears);
  var yearSet = {}, years = [], r, d, y;
  for (r = 0; r < rows.length; r++) {
    d = rows[r] && rows[r].date ? String(rows[r].date) : '';
    y = d.substring(0, 4);
    if (y && !yearSet.hasOwnProperty(y)) { yearSet[y] = true; years.push(y); }
  }
  years.sort(function (a, b) { return a < b ? 1 : (a > b ? -1 : 0); });
  var yopt;
  for (i = 0; i < years.length; i++) {
    yopt = document.createElement('option');
    yopt.value = years[i]; yopt.textContent = years[i];
    yearSelect.appendChild(yopt);
  }

  var lblYear = document.createElement('label');
  lblYear.textContent = 'Год ';
  lblYear.appendChild(yearSelect);
  var lblStatus = document.createElement('label');
  lblStatus.textContent = ' Статус ';
  lblStatus.appendChild(statusSelect);
  bar.appendChild(lblYear);
  bar.appendChild(lblStatus);
  table.parentNode.parentNode.insertBefore(bar, table.parentNode);

  var ctx = {
    statusSelect: statusSelect,
    yearSelect: yearSelect,
    rows: block1RowEls(root),
    jsonRows: rows,
    totalCell: block1TotalCell(root),
    state: state
  };
  var handler = function () { applyBlock1Filter(ctx); };
  statusSelect.addEventListener('change', handler);
  yearSelect.addEventListener('change', handler);
}

function block1RowEls(root) {
  var section = root.querySelector('[data-sd-block="b1"]');
  if (!section) { return []; }
  var nodeList = section.querySelectorAll('table.sd-tbl tbody tr[data-date]');
  var arr = [], i;
  for (i = 0; i < nodeList.length; i++) { arr.push(nodeList[i]); }
  return arr;
}

function block1TotalCell(root) {
  var section = root.querySelector('[data-sd-block="b1"]');
  if (!section) { return null; }
  return section.querySelector('table.sd-tbl tfoot .sd-total');
}

function applyBlock1Filter(ctx) {
  var status = ctx.statusSelect && ctx.statusSelect.value ? ctx.statusSelect.value : '';
  var year = ctx.yearSelect && ctx.yearSelect.value ? ctx.yearSelect.value : '';
  var rows = ctx.rows, data = ctx.jsonRows;
  var total = 0, byInn = {}, order = [], i;

  for (i = 0; i < rows.length; i++) {
    var tr = rows[i];
    var rowDate = tr.getAttribute('data-date') || '';
    var rowStatus = tr.getAttribute('data-status') || '';
    var show = true;
    if (status && status !== '__ALL__' && rowStatus !== status) { show = false; }
    if (year && rowDate && rowDate.substring(0, 4) !== year) { show = false; }
    tr.style.display = show ? '' : 'none';
    if (show) {
      var rec = data && data[i] ? data[i] : null;
      var amount = rec && rec.amount !== undefined && rec.amount !== null ? Number(rec.amount) : 0;
      if (!isFinite(amount)) { amount = 0; }
      total += amount;
      var inn = rec && rec.inn !== undefined && rec.inn !== null ? String(rec.inn) : '';
      var name = rec && rec.customer !== undefined && rec.customer !== null ? String(rec.customer) : inn;
      if (!byInn.hasOwnProperty(inn)) { byInn[inn] = { name: name || inn, amount: 0 }; order.push(inn); }
      byInn[inn].amount += amount;
    }
  }

  if (ctx.totalCell) { ctx.totalCell.textContent = formatRub(total) + MONEY_SUFFIX; }

  if (ctx.state.b1chart) {
    var labels = [], values = [];
    for (i = 0; i < order.length; i++) {
      var sliceName = byInn[order[i]].name;
      labels.push(sliceName === '' ? 'Без ИНН' : sliceName);
      values.push(byInn[order[i]].amount);
    }
    var chart = ctx.state.b1chart;
    chart.data.labels = labels;
    chart.data.datasets[0].data = values;
    chart.data.datasets[0].backgroundColor = paletteFor(labels.length);
    chart.update();
  }
}

// ---------------------------------------------------------------------------
// ДИАГРАММЫ БЛОКА 1.
// ---------------------------------------------------------------------------
export function drawBlock1Charts(root, data, state) {
  if (!CHART_READY) { showChartFallback(root, 'b1'); showChartFallback(root, 'b1pay'); return; }
  var rows = (data.block1 && data.block1.rows) ? data.block1.rows : [];

  var b1canvas = root.querySelector('canvas[data-sd-chart="b1"]');
  if (b1canvas) {
    destroyExisting(b1canvas);
    var bc = block1ByCustomer(rows);
    var chart1 = new C(b1canvas, doughnutConfig(bc.labels, bc.values));
    b1canvas.__sdChart = chart1;
    state.b1chart = chart1;
  }

  // «По оплате» — из payByCustomer года, выбранного в Блоке 3 (год отгрузки).
  var bpCanvas = root.querySelector('canvas[data-sd-chart="b1pay"]');
  if (bpCanvas) {
    var econ = yearEconomics(data, state.yearShip);
    var bp = econ.payByCustomer || [];
    if (bp.length) {
      destroyExisting(bpCanvas);
      var payLabels = [], payValues = [], k;
      for (k = 0; k < bp.length; k++) { payLabels.push(String(bp[k].name || '')); payValues.push(num(bp[k].amount)); }
      var chartPay = new C(bpCanvas, doughnutConfig(payLabels, payValues));
      bpCanvas.__sdChart = chartPay;
      state.b1paychart = chartPay;
    }
  }
}

// Перерисовать только диаграмму «По оплате» Блока 1 (зависит от года Блока 3).
export function redrawPayChart(root, data, state) {
  var bpCanvas = root.querySelector('canvas[data-sd-chart="b1pay"]');
  if (!bpCanvas) { return; }
  if (!CHART_READY) { return; }
  destroyExisting(bpCanvas);
  var econ = yearEconomics(data, state.yearShip);
  var bp = econ.payByCustomer || [];
  if (!bp.length) { state.b1paychart = null; return; }
  var payLabels = [], payValues = [], k;
  for (k = 0; k < bp.length; k++) { payLabels.push(String(bp[k].name || '')); payValues.push(num(bp[k].amount)); }
  var chartPay = new C(bpCanvas, doughnutConfig(payLabels, payValues));
  bpCanvas.__sdChart = chartPay;
  state.b1paychart = chartPay;
}
