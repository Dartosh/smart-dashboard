/*!
 * smart-dashboard client (vanilla, IIFE, no jQuery).
 *
 * Consumes the EXACT output of Smart\Render\DashboardView:
 *   - root container:  <div class="smart-dash"> ... </div>
 *   - per-block JSON:  <script type="application/json" data-sd="b1|b2|b3">{...}</script>
 *                      (one script PER block; values are faithful after JSON.parse because
 *                       DashboardView used JSON_HEX_TAG|JSON_HEX_AMP|JSON_HEX_APOS|JSON_HEX_QUOT,
 *                       so we must NOT manually entity-decode textContent).
 *   - charts:          <canvas id="sd-bNchart" data-sd-chart="bN"> — may be ABSENT even when the
 *                       JSON is present (empty block1 / all-zero block3 emit JSON but no canvas);
 *                       a fully-null block emits neither. Hence every canvas lookup is null-checked.
 *   - block1 rows:     <tr data-date="YYYY-MM-DD" data-status="<normalized>"> in <table class="sd-tbl">,
 *                       total in <tfoot> <td class="sd-total">.
 *
 * Renders 3 charts (doughnut/line/bar) via a LOCAL Chart.js reference and applies Block 1
 * client-side filters (period + status) recomputing the total and redrawing the doughnut.
 * Number formatting is byte-identical to Smart\Support\Money::rub
 * (integer rubles, U+00A0 group separator, no currency sign).
 */
(function () {
  'use strict';

  // Local reference to the Chart constructor; do not trust window.Chart to stay ours after host code.
  var C = window.Chart;

  // Currency suffix appended after the formatted number (thin space U+2009 + ruble sign),
  // mirroring DashboardView which prints Money::rub + '&#8201;&#8381;'.
  var THINSP = ' ';
  var RUB = '₽';
  var MONEY_SUFFIX = THINSP + RUB;

  // --- Number formatter: identical to Money::rub (integer rubles, NBSP U+00A0 group separator, no currency sign).
  var NBSP = ' ';

  function formatRub(amount) {
    var n = Number(amount);
    if (!isFinite(n)) {
      n = 0;
    }
    // round half up to integer rubles (away from zero for negatives) — mirrors Money::roundRub.
    var rounded;
    if (n >= 0) {
      rounded = Math.floor(n + 0.5);
    } else {
      rounded = -Math.floor(-n + 0.5);
    }
    var negative = rounded < 0;
    var digits = String(Math.abs(rounded));
    var out = '';
    var count = 0;
    var i;
    for (i = digits.length - 1; i >= 0; i--) {
      out = digits.charAt(i) + out;
      count++;
      if (count % 3 === 0 && i > 0) {
        out = NBSP + out;
      }
    }
    return negative ? '-' + out : out;
  }

  var MONTH_LABELS = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];

  // Doughnut palette (neutral blue family, matches mockup-a-v1.html visual reference).
  var PALETTE = ['#2f5d9e', '#4a7bc8', '#6f9bd8', '#9bbce6', '#c2d6f0', '#1f3f6e', '#86a8d4', '#5a86c2'];

  // Read a single block's inline JSON by its data-sd tag. DashboardView emits one script per block.
  // textContent is already faithful (hex-escaped by json_encode), so plain JSON.parse — NO entity decode.
  function readBlock(root, tag) {
    var node = root.querySelector('script[type="application/json"][data-sd="' + tag + '"]');
    if (!node) {
      return null;
    }
    var raw = node.textContent || '';
    try {
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function destroyExisting(canvas) {
    // Chart.js v4: getChart returns the instance bound to a canvas, if any.
    if (C && typeof C.getChart === 'function') {
      var existing = C.getChart(canvas);
      if (existing) {
        existing.destroy();
        return;
      }
    }
    // Fallback: instance stashed by us on a previous run.
    if (canvas.__sdChart) {
      try {
        canvas.__sdChart.destroy();
      } catch (e) {
        /* ignore */
      }
      canvas.__sdChart = null;
    }
  }

  function paletteFor(count) {
    var colors = [];
    var i;
    for (i = 0; i < count; i++) {
      colors.push(PALETTE[i % PALETTE.length]);
    }
    return colors;
  }

  // --- Block 1: doughnut config from labels/values arrays.
  function doughnutConfig(labels, values) {
    return {
      type: 'doughnut',
      data: {
        labels: labels,
        datasets: [{ data: values, backgroundColor: paletteFor(labels.length), borderWidth: 1, borderColor: '#ffffff' }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'right' },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                return ctx.label + ': ' + formatRub(ctx.parsed) + MONEY_SUFFIX;
              }
            }
          }
        }
      }
    };
  }

  function lineConfig(monthly) {
    var revenue = [];
    var expense = [];
    var profit = [];
    var byMonth = {};
    var i;
    if (monthly && monthly.length) {
      for (i = 0; i < monthly.length; i++) {
        byMonth[Number(monthly[i].month)] = monthly[i];
      }
    }
    for (i = 1; i <= 12; i++) {
      var m = byMonth[i];
      revenue.push(m ? Number(m.revenue) : 0);
      expense.push(m ? Number(m.expense) : 0);
      profit.push(m ? Number(m.profit) : 0);
    }
    return {
      type: 'line',
      data: {
        labels: MONTH_LABELS,
        datasets: [
          { label: 'Доход', data: revenue, borderColor: '#2f5d9e', backgroundColor: 'rgba(47,93,158,0.10)', tension: 0.25, fill: false },
          { label: 'Расход', data: expense, borderColor: '#c0504d', backgroundColor: 'rgba(192,80,77,0.10)', tension: 0.25, fill: false },
          { label: 'Прибыль', data: profit, borderColor: '#4a7bc8', backgroundColor: 'rgba(74,123,200,0.10)', tension: 0.25, fill: false }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top' },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                return ctx.dataset.label + ': ' + formatRub(ctx.parsed.y) + MONEY_SUFFIX;
              }
            }
          }
        },
        scales: {
          y: {
            ticks: {
              callback: function (value) {
                return formatRub(value);
              }
            }
          }
        }
      }
    };
  }

  function barConfig(months) {
    var values = [];
    var i;
    for (i = 1; i <= 12; i++) {
      // months is a {1..12: float} object (JSON keys are strings); always emit 12 bars, 0 for missing.
      var v = (months && months[i] !== undefined && months[i] !== null) ? Number(months[i]) : 0;
      values.push(isFinite(v) ? v : 0);
    }
    return {
      type: 'bar',
      data: {
        labels: MONTH_LABELS,
        datasets: [{ label: 'Отгрузки', data: values, backgroundColor: '#4a7bc8', borderColor: '#2f5d9e', borderWidth: 1, borderRadius: 4, borderSkipped: false }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                return formatRub(ctx.parsed.y) + MONEY_SUFFIX;
              }
            }
          }
        },
        scales: {
          y: {
            ticks: {
              callback: function (value) {
                return formatRub(value);
              }
            }
          }
        }
      }
    };
  }

  // ----- Block 1 filtering -----
  // DashboardView emits <tr data-date data-status> but NO per-row inn/amount and NO filter controls.
  // We pair each visible <tr> with its block1.rows[] entry by index (same source order) to recompute
  // the total and aggregate the doughnut by INN from the visible subset.

  function block1Rows(root) {
    // Only the data rows inside <tbody> of the block1 table carry data-date.
    var section = root.querySelector('[data-sd-block="b1"]');
    if (!section) {
      return [];
    }
    var nodeList = section.querySelectorAll('table.sd-tbl tbody tr[data-date]');
    var arr = [];
    var i;
    for (i = 0; i < nodeList.length; i++) {
      arr.push(nodeList[i]);
    }
    return arr;
  }

  function block1TotalCell(root) {
    var section = root.querySelector('[data-sd-block="b1"]');
    if (!section) {
      return null;
    }
    return section.querySelector('table.sd-tbl tfoot .sd-total');
  }

  function applyBlock1Filter(root, ctx) {
    var from = ctx.fromInput && ctx.fromInput.value ? ctx.fromInput.value : '';
    var to = ctx.toInput && ctx.toInput.value ? ctx.toInput.value : '';
    var status = ctx.statusSelect && ctx.statusSelect.value ? ctx.statusSelect.value : '';

    var rows = ctx.rows;
    var data = ctx.jsonRows; // block1.rows[] aligned by index with rows[]
    var total = 0;
    var byInn = {};
    var order = [];
    var i;

    for (i = 0; i < rows.length; i++) {
      var tr = rows[i];
      var rowDate = tr.getAttribute('data-date') || '';
      var rowStatus = tr.getAttribute('data-status') || '';
      var show = true;
      // ISO YYYY-MM-DD strings compare lexicographically == chronologically.
      if (from && rowDate && rowDate < from) {
        show = false;
      }
      if (to && rowDate && rowDate > to) {
        show = false;
      }
      if (status && status !== '__ALL__' && rowStatus !== status) {
        show = false;
      }
      tr.style.display = show ? '' : 'none';

      if (show) {
        var rec = data && data[i] ? data[i] : null;
        var amount = rec && rec.amount !== undefined && rec.amount !== null ? Number(rec.amount) : 0;
        if (!isFinite(amount)) {
          amount = 0;
        }
        total += amount;
        var inn = rec && rec.inn !== undefined && rec.inn !== null ? String(rec.inn) : '';
        var name = rec && rec.customer !== undefined && rec.customer !== null ? String(rec.customer) : inn;
        if (!byInn.hasOwnProperty(inn)) {
          byInn[inn] = { name: name || inn, amount: 0 };
          order.push(inn);
        }
        byInn[inn].amount += amount;
      }
    }

    if (ctx.totalCell) {
      ctx.totalCell.textContent = formatRub(total) + MONEY_SUFFIX;
    }

    if (ctx.state.b1chart) {
      var labels = [];
      var values = [];
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

  // Build the filter UI (period + status) — DashboardView does not emit it, so we inject it,
  // populating the status options from block1.statuses. Idempotent via a data flag on the form.
  function buildBlock1Filters(root, block1, state) {
    var section = root.querySelector('[data-sd-block="b1"]');
    if (!section) {
      return;
    }
    var table = section.querySelector('table.sd-tbl');
    if (!table) {
      // No table => empty block1 (no rows). Nothing to filter.
      return;
    }
    if (section.querySelector('[data-sd-filters]')) {
      return; // already built
    }

    var bar = document.createElement('div');
    bar.className = 'sd-filters';
    bar.setAttribute('data-sd-filters', '1');

    var fromInput = document.createElement('input');
    fromInput.type = 'date';
    fromInput.setAttribute('data-sd-filter', 'date-from');

    var toInput = document.createElement('input');
    toInput.type = 'date';
    toInput.setAttribute('data-sd-filter', 'date-to');

    var statusSelect = document.createElement('select');
    statusSelect.setAttribute('data-sd-filter', 'status');
    var all = document.createElement('option');
    all.value = '__ALL__';
    all.textContent = 'Все';
    statusSelect.appendChild(all);
    var statuses = (block1 && block1.statuses && block1.statuses.length) ? block1.statuses : [];
    var i;
    for (i = 0; i < statuses.length; i++) {
      var opt = document.createElement('option');
      opt.value = String(statuses[i]);
      opt.textContent = String(statuses[i]);
      statusSelect.appendChild(opt);
    }

    var lblFrom = document.createElement('label');
    lblFrom.textContent = 'С ';
    lblFrom.appendChild(fromInput);
    var lblTo = document.createElement('label');
    lblTo.textContent = ' по ';
    lblTo.appendChild(toInput);
    var lblStatus = document.createElement('label');
    lblStatus.textContent = ' Статус ';
    lblStatus.appendChild(statusSelect);

    bar.appendChild(lblFrom);
    bar.appendChild(lblTo);
    bar.appendChild(lblStatus);

    table.parentNode.insertBefore(bar, table);

    var ctx = {
      fromInput: fromInput,
      toInput: toInput,
      statusSelect: statusSelect,
      rows: block1Rows(root),
      jsonRows: (block1 && block1.rows && block1.rows.length) ? block1.rows : [],
      totalCell: block1TotalCell(root),
      state: state
    };

    var handler = function () {
      applyBlock1Filter(root, ctx);
    };
    fromInput.addEventListener('change', handler);
    fromInput.addEventListener('input', handler);
    toInput.addEventListener('change', handler);
    toInput.addEventListener('input', handler);
    statusSelect.addEventListener('change', handler);
  }

  // Reload the page setting the chosen year on the given query param (paramName),
  // preserving EVERY other param — including the OTHER block's year param and any
  // host (Bitrix) params. A full reload is intended — the server recomputes the
  // affected block for the chosen (allowlisted) year. paramName is per-block:
  // 'sd_year_econ' for Block 2, 'sd_year_ship' for Block 3.
  function reloadWithYear(paramName, year) {
    if (!paramName || !year) {
      return;
    }
    var loc = window.location;
    var search = loc.search || '';
    var query = search.charAt(0) === '?' ? search.substring(1) : search;
    var parts = query ? query.split('&') : [];
    var out = [];
    var replaced = false;
    var i;
    for (i = 0; i < parts.length; i++) {
      if (parts[i] === '') {
        continue;
      }
      var key = parts[i].split('=')[0];
      if (key === paramName) {
        out.push(paramName + '=' + encodeURIComponent(year));
        replaced = true;
      } else {
        out.push(parts[i]);
      }
    }
    if (!replaced) {
      out.push(paramName + '=' + encodeURIComponent(year));
    }
    loc.href = loc.pathname + '?' + out.join('&') + (loc.hash || '');
  }

  // Year selectors: live INSIDE Block 2 (Экономика) and Block 3 (Отгрузки) —
  // the blocks they actually control — not in the page header. Each select drives
  // its OWN server-side param (sd_year_econ vs sd_year_ship), read from the
  // select's data-sd-year attribute, so the two are INDEPENDENT. Bind ALL of them
  // (querySelectorAll). On change, set that block's query param and reload,
  // preserving the other block's param; the server recomputes only the affected
  // block. ES5, no jQuery. Idempotent: a data flag PER select prevents
  // double-binding on re-init.
  function bindYearSelects(root) {
    var selects = root.querySelectorAll('select[data-sd-year]');
    var i;
    for (i = 0; i < selects.length; i++) {
      bindOneYearSelect(selects[i], root);
    }
  }

  function bindOneYearSelect(select, root) {
    if (select.getAttribute('data-sd-year-bound') === '1') {
      return;
    }
    select.setAttribute('data-sd-year-bound', '1');
    select.addEventListener('change', function () {
      // Смена года -> ПОЛНЫЙ reload (сервер пересчитывает затронутый блок, ~13 c
      // на cache-miss). Показываем оверлей НА ТЕКУЩЕЙ странице ДО навигации,
      // чтобы он оставался виден всё время серверного ожидания, пока новая
      // страница не заменит текущую. Имя параметра берём из data-sd-year самого
      // селектора (sd_year_econ для Блока 2, sd_year_ship для Блока 3) — блоки
      // независимы, параметр второго блока сохраняется при reload.
      showLoader(root);
      var paramName = select.getAttribute('data-sd-year');
      reloadWithYear(paramName, select.value);
    });
  }

  // --- Loader overlay: scoped to a .smart-dash root, idempotent.
  // DashboardView renders <div class="sd-loader" data-sd-loader> visible by
  // default; we hide it after init and re-show it before a year-change reload.
  function loaderEl(root) {
    return root ? root.querySelector('[data-sd-loader]') : null;
  }

  function hideLoader(root) {
    var el = loaderEl(root);
    if (!el) {
      return;
    }
    el.setAttribute('hidden', 'hidden');
    el.className = el.className.indexOf('is-hidden') === -1
      ? (el.className ? el.className + ' is-hidden' : 'is-hidden')
      : el.className;
    el.style.display = 'none';
  }

  function showLoader(root) {
    var el = loaderEl(root);
    if (!el) {
      return;
    }
    el.removeAttribute('hidden');
    el.className = el.className.replace(/(^|\s)is-hidden(\s|$)/g, ' ').replace(/^\s+|\s+$/g, '');
    el.style.display = 'flex';
  }

  function initRoot(root) {
    // Idempotency guard: never initialize the same container twice.
    if (root.getAttribute('data-sd-init') === '1') {
      return;
    }

    // Wrap the whole init body so the loader is ALWAYS hidden on the way out
    // (finally-style), even if Chart.js throws mid-init — a chart error must not
    // leave the overlay stuck over the dashboard. hideLoader is idempotent.
    try {
      // Chart.js must be present and the right major version (4). Without it, render tables/filters only.
      var chartReady = !!(C && C.version && String(C.version).charAt(0) === '4');

      var block1 = readBlock(root, 'b1');
      var block2 = readBlock(root, 'b2');
      var block3 = readBlock(root, 'b3');

      var state = { b1chart: null, b1paychart: null, b2chart: null, b3chart: null };

      // Year selectors (live inside Blocks 2/3): bind ALL -> reload with each
      // block's own param (sd_year_econ / sd_year_ship), independently.
      bindYearSelects(root);

      // Block 1: doughnut by customer. JSON may be present while the canvas is absent (empty rows) — null-check.
      if (chartReady && block1 && block1.byCustomer) {
        var b1canvas = root.querySelector('canvas[data-sd-chart="b1"]');
        if (b1canvas) {
          destroyExisting(b1canvas);
          var bc = block1.byCustomer;
          var labels = [];
          var values = [];
          var j;
          for (j = 0; j < bc.length; j++) {
            labels.push(bc[j].name);
            values.push(Number(bc[j].amount));
          }
          var chart1 = new C(b1canvas, doughnutConfig(labels, values));
          b1canvas.__sdChart = chart1;
          state.b1chart = chart1;
        }
      }

      // Block 1: second doughnut "по оплате" from block1.byPayment (same shape as
      // byCustomer: [{inn,name,amount}]). Static (not affected by the period/status
      // filter). Skip silently if byPayment is empty/absent or its canvas is missing.
      if (chartReady && block1 && block1.byPayment && block1.byPayment.length) {
        var bpCanvas = root.querySelector('canvas[data-sd-chart="b1pay"]');
        if (bpCanvas) {
          destroyExisting(bpCanvas);
          var bp = block1.byPayment;
          var payLabels = [];
          var payValues = [];
          var k;
          for (k = 0; k < bp.length; k++) {
            payLabels.push(bp[k].name);
            payValues.push(Number(bp[k].amount));
          }
          var chartPay = new C(bpCanvas, doughnutConfig(payLabels, payValues));
          bpCanvas.__sdChart = chartPay;
          state.b1paychart = chartPay;
        }
      }

      // Block 1 filters: build UI from data + bind handlers (independent of Chart.js availability).
      if (block1) {
        buildBlock1Filters(root, block1, state);
      }

      // Block 2: monthly P&L line. (canvas always emitted when block2 != null, but null-check anyway.)
      if (chartReady && block2 && block2.monthly) {
        var b2canvas = root.querySelector('canvas[data-sd-chart="b2"]');
        if (b2canvas) {
          destroyExisting(b2canvas);
          var chart2 = new C(b2canvas, lineConfig(block2.monthly));
          b2canvas.__sdChart = chart2;
          state.b2chart = chart2;
        }
      }

      // Block 3: monthly shipments bar. JSON present + all-zero months => no canvas — null-check.
      if (chartReady && block3 && block3.months) {
        var b3canvas = root.querySelector('canvas[data-sd-chart="b3"]');
        if (b3canvas) {
          destroyExisting(b3canvas);
          var chart3 = new C(b3canvas, barConfig(block3.months));
          b3canvas.__sdChart = chart3;
          state.b3chart = chart3;
        }
      }

      root.setAttribute('data-sd-init', '1');
    } finally {
      // Init done (charts drawn + filters/year selects bound): hide the overlay
      // that covered the dashboard during the chart-less initial-load flash.
      hideLoader(root);
    }
  }

  function initAll() {
    var roots = document.querySelectorAll('.smart-dash');
    var i;
    for (i = 0; i < roots.length; i++) {
      initRoot(roots[i]);
    }
  }

  // Timing: run regardless of load state (DashboardView may inline us mid-page or after DOMContentLoaded).
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAll);
  } else {
    initAll();
  }

  // Expose a manual re-init hook for AJAX-driven host pages (Bitrix area reload re-runs initAll on new roots).
  if (!window.SmartDash) {
    window.SmartDash = {};
  }
  window.SmartDash.init = initAll;
})();
