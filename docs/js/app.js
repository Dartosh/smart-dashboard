/*!
 * app.js — ВХОД (type=module).
 *
 *   - fetch(SD_DATA_URL || './data.json', {cache:'no-store'});
 *   - оркестрация рендера всех блоков;
 *   - независимые селекторы года (sd_year_econ / sd_year_ship), без сети;
 *   - биндинги фильтров Блока 1 и тумблера «Скрыть данные»;
 *   - обработка ошибок загрузки/отрисовки, лоадер-оверлей.
 *
 * Читает РОВНО контракт data.json (schema=1):
 *   meta{generatedAt,reportYears,defaultYear,org,inn,schema}
 *   block1{rows:[{regnum,reestr,date,customer,inn,status,amount}]}
 *   years{ "<Y>": { shipTotal, shipMonths[12], expense, expMonths[12],
 *                   receivable, payable, payTotal, payByCustomer[{inn,name,amount}],
 *                   revenueNet, ofr:{2110,2120,2210,2220,2200,period,ref}|null } }
 */
import { esc, fmtGeneratedAt } from './format.js';
import { block1Html, buildBlock1Filters, drawBlock1Charts } from './block1.js';
import { block2Html, drawBlock2Chart, rerenderBlock2 } from './block2.js';
import { block3Html, drawBlock3Chart, rerenderBlock3 } from './block3.js';
import { bindOfrToggle } from './ofr.js';

// ----- Шапка -----
function headerHtml(data) {
  var html = '<div class="sd-head">';
  html += '<h1>СМАРТ ООО · Аналитика</h1>';
  var gen = data.meta && data.meta.generatedAt ? data.meta.generatedAt : '';
  if (gen) {
    html += '<div class="sd-asof">' + esc('Данные на ' + fmtGeneratedAt(gen)) + '</div>';
  }
  html += '<button type="button" class="sd-toggle" data-sd-toggle-data>Скрыть данные</button>';
  html += '</div>';
  return html;
}

// ---------------------------------------------------------------------------
// СЕЛЕКТОРЫ ГОДА — клиентские (без reload). Блоки 2 и 3 независимы.
// ---------------------------------------------------------------------------
function bindYearSelectsIn(scope, root, data, state) {
  var selects = scope.querySelectorAll('select[data-sd-year]');
  var i;
  for (i = 0; i < selects.length; i++) { bindOneYearSelect(selects[i], root, data, state); }
}

function bindOneYearSelect(select, root, data, state) {
  if (select.getAttribute('data-sd-year-bound') === '1') { return; }
  select.setAttribute('data-sd-year-bound', '1');
  var paramName = select.getAttribute('data-sd-year');
  select.addEventListener('change', function () {
    var val = select.value;
    var yearKey = (val === 'all') ? 'all' : Number(val);
    if (paramName === 'sd_year_econ') {
      state.yearEcon = yearKey;
      rerenderBlock2(root, data, state, bindYearSelectsIn);
    } else if (paramName === 'sd_year_ship') {
      state.yearShip = yearKey;
      rerenderBlock3(root, data, state, bindYearSelectsIn);
    }
  });
}

// ---------------------------------------------------------------------------
// Тумблер «Скрыть данные».
// ---------------------------------------------------------------------------
function bindHideToggle(root) {
  var tgl = root.querySelector('[data-sd-toggle-data]');
  if (!tgl) { return; }
  tgl.addEventListener('click', function () {
    var on = root.className.indexOf('sd-charts-only') === -1;
    root.className = on
      ? (root.className + ' sd-charts-only')
      : root.className.replace(/(^|\s)sd-charts-only(\s|$)/g, ' ').replace(/^\s+|\s+$/g, '');
    tgl.textContent = on ? 'Показать данные' : 'Скрыть данные';
    if (window.dispatchEvent) { window.dispatchEvent(new Event('resize')); }
  });
}

// ---------------------------------------------------------------------------
// Лоадер-оверлей.
// ---------------------------------------------------------------------------
function hideLoader(root) {
  var el = root ? root.querySelector('[data-sd-loader]') : null;
  if (!el) { return; }
  el.setAttribute('hidden', 'hidden');
  el.style.display = 'none';
}

function showError(root, message) {
  var el = root.querySelector('[data-sd-loader]');
  var box = document.createElement('div');
  box.className = 'sd-block';
  box.innerHTML = '<p class="sd-unavailable">' + esc(message) + '</p>';
  if (el && el.parentNode) { el.parentNode.insertBefore(box, el); }
  else { root.appendChild(box); }
  hideLoader(root);
}

// ---------------------------------------------------------------------------
// СБОРКА ДАШБОРДА после загрузки JSON.
// ---------------------------------------------------------------------------
function buildDashboard(root, data) {
  var meta = data.meta || {};
  var defaultYear = meta.defaultYear ? Number(meta.defaultYear) : (meta.reportYears && meta.reportYears.length ? Number(meta.reportYears[0]) : 'all');

  var state = {
    yearEcon: defaultYear,
    yearShip: defaultYear,
    b1chart: null, b1paychart: null, b2chart: null, b3chart: null
  };

  var loader = root.querySelector('[data-sd-loader]');

  // Соберём HTML всех блоков и вставим ПЕРЕД лоадером (лоадер скроем в конце).
  var html = '';
  html += headerHtml(data);
  html += block1Html(data);
  html += block2Html(data, state.yearEcon);
  html += block3Html(data, state.yearShip);

  var holder = document.createElement('div');
  holder.setAttribute('data-sd-content', '1');
  holder.innerHTML = html;
  if (loader && loader.parentNode) { loader.parentNode.insertBefore(holder, loader); }
  else { root.appendChild(holder); }

  // Графики.
  drawBlock1Charts(root, data, state);
  drawBlock2Chart(root, data, state);
  drawBlock3Chart(root, data, state);

  // Фильтры Блока 1.
  buildBlock1Filters(root, data, state);

  // Селекторы года (клиентские).
  bindYearSelectsIn(holder, root, data, state);

  // Toggle сверки ОФР.
  bindOfrToggle(holder);

  // Тумблер «Скрыть данные».
  bindHideToggle(root);

  hideLoader(root);
}

// ---------------------------------------------------------------------------
// ВХОД: fetch(SD_DATA_URL) -> сборка.
// ---------------------------------------------------------------------------
function start() {
  var root = document.getElementById('smart-dash-root') || document.querySelector('.smart-dash');
  if (!root) { return; }
  if (root.getAttribute('data-sd-init') === '1') { return; }
  root.setAttribute('data-sd-init', '1');

  var url = (typeof window.SD_DATA_URL !== 'undefined' && window.SD_DATA_URL) ? window.SD_DATA_URL : './data.json';
  if (!url) { showError(root, 'Не задан SD_DATA_URL — укажите URL вашего data.json.'); return; }

  if (!window.fetch) { showError(root, 'Браузер не поддерживает fetch — обновите браузер.'); return; }

  fetch(url, { cache: 'no-store' })
    .then(function (resp) {
      if (!resp.ok) { throw new Error('HTTP ' + resp.status); }
      return resp.json();
    })
    .then(function (data) {
      try { buildDashboard(root, data); }
      catch (e) { showError(root, 'Ошибка отрисовки дашборда: ' + (e && e.message ? e.message : e)); }
    })
    .catch(function (e) {
      showError(root, 'Не удалось загрузить данные (' + url + '): ' + (e && e.message ? e.message : e));
    });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}
