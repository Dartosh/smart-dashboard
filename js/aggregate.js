/*!
 * aggregate.js — деривации из контракта данных (schema=1) и агрегация «Все года».
 *
 * Все производные считаются НА КЛИЕНТЕ:
 *   - прибыль = shipTotal − expense, рентабельность = прибыль / shipTotal;
 *   - помесячная прибыль = shipMonths[m] − expMonths[m];
 *   - byCustomer / уникальные статусы / Итого Блока 1;
 *   - KPI Блока 3 (months/total/payTotal);
 *   - «Все года»: суммы по годам, payByCustomer — слияние по inn,
 *                 ДЗ/КЗ — из самого позднего года (max reportYears).
 */
import { num } from './format.js';

// 12-элементный массив из shipMonths/expMonths (терпим к коротким/отсутствующим).
export function months12(arr) {
  var out = [], i;
  for (i = 0; i < 12; i++) { out.push(arr && arr[i] !== undefined && arr[i] !== null ? num(arr[i]) : 0); }
  return out;
}

// Итого Блока 1 = сумма amount всех строк (вся история, без фильтра).
export function block1Total(rows) {
  var t = 0, i;
  for (i = 0; i < rows.length; i++) { t += num(rows[i].amount); }
  return t;
}

// Уникальные статусы Блока 1 (в порядке появления).
export function block1Statuses(rows) {
  var seen = {}, out = [], i, s;
  for (i = 0; i < rows.length; i++) {
    s = String(rows[i].status || '');
    if (s !== '' && !seen.hasOwnProperty(s)) { seen[s] = true; out.push(s); }
  }
  return out;
}

// Диаграмма «По объёму контрактов» — агрегат rows по inn (вся история).
export function block1ByCustomer(rows) {
  var byInn = {}, order = [], i, inn, name;
  for (i = 0; i < rows.length; i++) {
    inn = String(rows[i].inn || '');
    name = String(rows[i].customer || '') || inn;
    if (!byInn.hasOwnProperty(inn)) { byInn[inn] = { name: name || 'Без ИНН', amount: 0 }; order.push(inn); }
    byInn[inn].amount += num(rows[i].amount);
  }
  var labels = [], values = [];
  for (i = 0; i < order.length; i++) {
    labels.push(byInn[order[i]].name === '' ? 'Без ИНН' : byInn[order[i]].name);
    values.push(byInn[order[i]].amount);
  }
  return { labels: labels, values: values };
}

// Экономика за конкретный год (или агрегат «все года»).
// Возвращает {revenue, expense, profit, margin, receivable, payable,
//             monthlyRevenue[12], monthlyExpense[12], monthlyProfit[12],
//             revenueNet, ofr, payTotal, payByCustomer}.
export function yearEconomics(data, yearKey) {
  var reportYears = (data.meta && data.meta.reportYears) ? data.meta.reportYears : [];
  var years = data.years || {};

  if (yearKey === 'all') {
    var revenue = 0, expense = 0, payTotal = 0;
    var mRev = [0,0,0,0,0,0,0,0,0,0,0,0];
    var mExp = [0,0,0,0,0,0,0,0,0,0,0,0];
    var payMap = {}, payOrder = [];
    var i, m, y, yd, sm, em, pbc, k, inn;
    // ДЗ/КЗ — из самого позднего года (max reportYears).
    var maxYear = null;
    for (i = 0; i < reportYears.length; i++) {
      y = Number(reportYears[i]);
      if (maxYear === null || y > maxYear) { maxYear = y; }
    }
    for (i = 0; i < reportYears.length; i++) {
      y = String(reportYears[i]);
      yd = years[y];
      if (!yd) { continue; }
      revenue += num(yd.shipTotal);
      expense += num(yd.expense);
      payTotal += num(yd.payTotal);
      sm = months12(yd.shipMonths); em = months12(yd.expMonths);
      for (m = 0; m < 12; m++) { mRev[m] += sm[m]; mExp[m] += em[m]; }
      pbc = yd.payByCustomer || [];
      for (k = 0; k < pbc.length; k++) {
        inn = String(pbc[k].inn || '');
        if (!payMap.hasOwnProperty(inn)) {
          payMap[inn] = { inn: inn, name: String(pbc[k].name || inn), amount: 0 };
          payOrder.push(inn);
        }
        payMap[inn].amount += num(pbc[k].amount);
      }
    }
    var payByCustomer = [];
    for (i = 0; i < payOrder.length; i++) { payByCustomer.push(payMap[payOrder[i]]); }
    payByCustomer.sort(function (a, b) { return b.amount - a.amount; });
    var mProfit = [];
    for (m = 0; m < 12; m++) { mProfit.push(mRev[m] - mExp[m]); }
    var latest = maxYear !== null ? years[String(maxYear)] : null;
    return {
      revenue: revenue, expense: expense, profit: revenue - expense,
      margin: revenue > 0 ? (revenue - expense) / revenue : null,
      receivable: latest ? num(latest.receivable) : 0,
      payable: latest ? num(latest.payable) : 0,
      monthlyRevenue: mRev, monthlyExpense: mExp, monthlyProfit: mProfit,
      revenueNet: 0, ofr: null,
      payTotal: payTotal, payByCustomer: payByCustomer
    };
  }

  var yd2 = years[String(yearKey)];
  if (!yd2) {
    return {
      revenue: 0, expense: 0, profit: 0, margin: null, receivable: 0, payable: 0,
      monthlyRevenue: months12(null), monthlyExpense: months12(null), monthlyProfit: months12(null),
      revenueNet: 0, ofr: null, payTotal: 0, payByCustomer: []
    };
  }
  var rev = num(yd2.shipTotal), exp = num(yd2.expense);
  var smv = months12(yd2.shipMonths), emv = months12(yd2.expMonths);
  var pm = [];
  var mm;
  for (mm = 0; mm < 12; mm++) { pm.push(smv[mm] - emv[mm]); }
  return {
    revenue: rev, expense: exp, profit: rev - exp,
    margin: rev > 0 ? (rev - exp) / rev : null,
    receivable: num(yd2.receivable), payable: num(yd2.payable),
    monthlyRevenue: smv, monthlyExpense: emv, monthlyProfit: pm,
    revenueNet: num(yd2.revenueNet), ofr: yd2.ofr || null,
    payTotal: num(yd2.payTotal), payByCustomer: yd2.payByCustomer || []
  };
}

// Отгрузки за год (или «все года»): {months[12], total, payTotal}.
export function yearShipments(data, yearKey) {
  var reportYears = (data.meta && data.meta.reportYears) ? data.meta.reportYears : [];
  var years = data.years || {};
  if (yearKey === 'all') {
    var mm = [0,0,0,0,0,0,0,0,0,0,0,0], total = 0, pay = 0, i, m, yd, sm;
    for (i = 0; i < reportYears.length; i++) {
      yd = years[String(reportYears[i])];
      if (!yd) { continue; }
      total += num(yd.shipTotal); pay += num(yd.payTotal);
      sm = months12(yd.shipMonths);
      for (m = 0; m < 12; m++) { mm[m] += sm[m]; }
    }
    return { months: mm, total: total, payTotal: pay };
  }
  var yd2 = years[String(yearKey)];
  if (!yd2) { return { months: months12(null), total: 0, payTotal: 0 }; }
  return { months: months12(yd2.shipMonths), total: num(yd2.shipTotal), payTotal: num(yd2.payTotal) };
}
