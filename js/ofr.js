/*!
 * ofr.js — сверка с ОФР (порт Reconcile.php) в HTML.
 *
 * Использует РЕГИСТРОВУЮ выручку-нетто (revenueNet), а НЕ «Доход (по отгрузке)».
 * Строки: Выручка (2110), Расход (2120+2210+2220), в т.ч. (2120)/(2220),
 * Прибыль от продаж (2200). Допуск ±1 ₽. Итог + примечание.
 */
import { num, formatCents, esc } from './format.js';

// Допуск ±1 ₽.
export var OFR_TOLERANCE = 1.0;
export function withinTolerance(dash, ref) { return Math.abs(dash - ref) <= OFR_TOLERANCE; }

// Сверка с ОФР (порт Reconcile::renderOfrReconciliation в HTML).
// Использует РЕГИСТРОВУЮ выручку-нетто (revenueNet), а НЕ «Доход (по отгрузке)».
export function ofrReconciliationHtml(yearKey, e) {
  var regRevenue = e.revenueNet;          // регистр: выручка-нетто
  var regExpense = e.expense;             // регистр: расход
  var regProfit = regRevenue - regExpense; // регистр: прибыль = revenueNet − expense
  var ofr = e.ofr;

  var html = '<div class="sd-ofr" data-sd-ofr><button type="button" class="sd-ofr-toggle" data-sd-ofr-toggle>'
    + '<span class="sd-ofr-caret">▶</span><span>Сверка с ОФР за ' + esc(String(yearKey)) + ' год</span></button>'
    + '<div class="sd-ofr-body">';

  html += '<p class="sd-ofr-note">Сверка использует <b>регистровую выручку-нетто</b> (а не «Доход (по отгрузке)»). Эталон — официальный ОФР из 1С.</p>';

  if (!ofr) {
    html += '<p class="sd-ofr-note sd-warn">годовой ОФР за ' + esc(String(yearKey)) + ' ещё не сдан — сверка недоступна</p>';
    html += '<div class="sd-table-wrap"><table class="sd-tbl"><thead><tr>'
      + '<th>Показатель регистра (дашборд)</th><th class="sd-num">Значение</th></tr></thead><tbody>';
    html += '<tr><td>Выручка (2110)</td><td class="sd-num">' + esc(formatCents(regRevenue)) + '</td></tr>';
    html += '<tr><td>Расход (2120+2220)</td><td class="sd-num">' + esc(formatCents(regExpense)) + '</td></tr>';
    html += '<tr><td>Прибыль от продаж (2200)</td><td class="sd-num">' + esc(formatCents(regProfit)) + '</td></tr>';
    html += '</tbody></table></div>';
    html += '</div></div>';
    return html;
  }

  var ofr2110 = num(ofr['2110']);
  var ofr2120 = num(ofr['2120']);
  var ofr2210 = num(ofr['2210']);
  var ofr2220 = num(ofr['2220']);
  var ofr2200 = num(ofr['2200']);
  var ofrExpense = ofr2120 + ofr2210 + ofr2220;

  var allOk = true;
  function rowHtml(label, dash, ref) {
    var ok = withinTolerance(dash, ref);
    if (!ok) { allOk = false; }
    var delta = dash - ref;
    return '<tr><td>' + esc(label) + '</td>'
      + '<td class="sd-num">' + esc(formatCents(dash)) + '</td>'
      + '<td class="sd-num">' + esc(formatCents(ref)) + '</td>'
      + '<td class="sd-num">' + esc(formatCents(delta)) + '</td>'
      + '<td>' + (ok ? '<span class="sd-yes">да</span>' : '<span class="sd-no">нет</span>') + '</td></tr>';
  }
  function ofrOnlyRowHtml(label, ref) {
    return '<tr><td>' + esc(label) + '</td>'
      + '<td class="sd-num sd-muted">—</td>'
      + '<td class="sd-num">' + esc(formatCents(ref)) + '</td>'
      + '<td class="sd-num sd-muted">—</td>'
      + '<td class="sd-muted">—</td></tr>';
  }

  var refTitle = '';
  if (ofr.ref) { refTitle += 'документ Ref_Key=' + String(ofr.ref); }
  var pm = /(\d{4})-?(\d{2})-?(\d{2})/.exec(String(ofr.period || ''));
  if (pm) { refTitle += (refTitle ? ', ' : '') + 'период до ' + pm[3] + '.' + pm[2] + '.' + pm[1]; }
  if (refTitle) { html += '<p class="sd-ofr-note">' + esc(refTitle) + '</p>'; }

  html += '<div class="sd-table-wrap"><table class="sd-tbl"><thead><tr>'
    + '<th>Показатель</th><th class="sd-num">Дашборд (регистр)</th><th class="sd-num">ОФР</th>'
    + '<th class="sd-num">Расхождение</th><th>В допуске (±1₽)?</th></tr></thead><tbody>';
  html += rowHtml('Выручка (2110)', regRevenue, ofr2110);
  html += rowHtml('Расход (2120+2220)', regExpense, ofrExpense);
  html += ofrOnlyRowHtml('в т.ч. Себестоимость (2120)', ofr2120);
  html += ofrOnlyRowHtml('в т.ч. Управленческие (2220)', ofr2220);
  html += rowHtml('Прибыль от продаж (2200)', regProfit, ofr2200);
  html += '</tbody></table></div>';

  html += allOk
    ? '<p class="sd-verdict sd-ok">ИТОГ: ВСЕ В ДОПУСКЕ</p>'
    : '<p class="sd-verdict sd-bad">ИТОГ: ЕСТЬ РАСХОЖДЕНИЯ</p>';
  html += '<p class="sd-ofr-note">Примечание: ОФР 2200 здесь точный (2110−2120−2210−2220); в выгрузке строки 2100/2200 бывают округлены до тысяч (Окр1000).</p>';

  html += '</div></div>';
  return html;
}

// Сворачиваемая секция ОФР — биндинг toggle.
export function bindOfrToggle(scope) {
  var box = scope.querySelector('[data-sd-ofr]');
  if (!box) { return; }
  var btn = box.querySelector('[data-sd-ofr-toggle]');
  if (!btn) { return; }
  btn.addEventListener('click', function () {
    if (box.className.indexOf('is-open') === -1) { box.className += ' is-open'; }
    else { box.className = box.className.replace(/(^|\s)is-open(\s|$)/g, ' ').replace(/^\s+|\s+$/g, ''); }
  });
}
