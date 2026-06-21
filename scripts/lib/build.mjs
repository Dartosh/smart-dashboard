// App::buildData — порт web/src/App.php (метод buildData).
// Собирает компактный снимок: meta + block1.rows (всеисторические контракты) +
// years[Y] (Блок 2/3, оплата, ОФР для сверки). Деньги округляются до копеек.

import { ContractsService } from './contracts.mjs';
import { EconomicsService } from './economics.mjs';
import { ShipmentsService } from './shipments.mjs';

/** Округление до копеек, как PHP round($v, 2). */
export function money2(v) {
  return roundDec(Number(v), 2);
}

/**
 * Округление как PHP round() при serialize_precision=-1 (дефолт PHP 7.1+).
 *
 * PHP round() делает «pre-rounding»: воспринимает значение как ЕГО кратчайшую
 * десятичную запись (2.675, а не 2.67499999…) и округляет half-away-from-zero
 * (2.675 → 2.68, 0.045 → 0.05). JS Number.toString() даёт ту же кратчайшую
 * round-trip запись (zend_dtoa mode 0 == ECMAScript Number→String), поэтому
 * округляем именно строковое представление — это воспроизводит PHP побайтно.
 * Проверено фуззингом на 2000+ значениях против php round()/json_encode().
 */
function roundDec(value, precision) {
  if (!Number.isFinite(value)) return value;
  if (value === 0) return 0;

  let s = value.toString();
  if (s.includes('e') || s.includes('E')) {
    // Очень большие/малые — нормализуем в фиксированную запись с запасом.
    s = value.toFixed(Math.max(precision + 2, 20));
  }

  const neg = s[0] === '-';
  if (neg) s = s.slice(1);

  const dot = s.indexOf('.');
  const intPart = dot === -1 ? s : s.slice(0, dot);
  const fracPart = dot === -1 ? '' : s.slice(dot + 1);

  if (fracPart.length <= precision) {
    return value; // нечего округлять
  }

  const roundDigit = fracPart.charCodeAt(precision) - 48; // цифра за позицией
  const keptFrac = fracPart.slice(0, precision);
  const digits = (intPart + keptFrac).split('').map((c) => c.charCodeAt(0) - 48);

  if (roundDigit >= 5) {
    let i = digits.length - 1;
    while (i >= 0) {
      digits[i]++;
      if (digits[i] < 10) break;
      digits[i] = 0;
      i--;
    }
    if (i < 0) digits.unshift(1);
  }

  const total = digits.join('');
  const intLen = total.length - precision;
  const ip = total.slice(0, intLen) || '0';
  const fp = total.slice(intLen);
  const resStr = fp.length ? ip + '.' + fp : ip;

  let num = parseFloat(resStr);
  if (neg) num = -num;
  if (num === 0) num = 0; // нормализуем -0 → 0
  return num;
}

/**
 * @param {object} deps {config, unf, buh}
 * @param {string} generatedAt ISO8601-метка момента генерации
 */
export async function buildData(deps, generatedAt) {
  const { config, unf, buh } = deps;
  const years = config.reportYears();

  // Блок 1 — всеисторический портфель (год не влияет).
  const contracts = new ContractsService(unf, config.contractGroupByRegnum());
  const block1 = await contracts.build();
  const rows = [];
  const srcRows = Array.isArray(block1.rows) ? block1.rows : [];
  for (const r of srcRows) {
    const reestr = (r.reestr !== undefined && r.reestr !== null && String(r.reestr) !== '')
      ? String(r.reestr) : null;
    rows.push({
      regnum: r.regnum !== undefined ? String(r.regnum) : '',
      reestr,
      date: r.date !== undefined ? String(r.date) : '',
      customer: r.customer !== undefined ? String(r.customer) : '',
      inn: r.inn !== undefined ? String(r.inn) : '',
      status: r.status !== undefined ? String(r.status) : '',
      amount: money2(r.amount !== undefined ? r.amount : 0.0),
    });
  }

  // years и ofr используют «целочисленные» строковые ключи ("2024","2110") —
  // JS-объект переупорядочил бы их по возрастанию, поэтому держим порядок
  // вставки через Map (phpJsonEncode сериализует Map в порядке вставки, как PHP).
  const yearsOut = new Map();
  for (let y of years) {
    y = parseInt(y, 10);

    // Блок 3 — отгрузки за год.
    const ship = await new ShipmentsService(unf, y, vidOperatsii()).build();
    const shipTotal = ship.total !== undefined ? Number(ship.total) : 0.0;
    const shipMonthsSrc = ship.months && typeof ship.months === 'object' ? ship.months : {};
    const shipMonths = [];
    for (let m = 1; m <= 12; m++) {
      shipMonths.push(money2(shipMonthsSrc[m] !== undefined ? shipMonthsSrc[m] : 0.0));
    }

    // Блок 2 — экономика регистра (RAW).
    const econ = await new EconomicsService(buh, y).build();
    const byMonthExp = {};
    const monthlySrc = Array.isArray(econ.monthly) ? econ.monthly : [];
    for (const pt of monthlySrc) {
      const mm = pt.month !== undefined ? parseInt(pt.month, 10) : 0;
      if (mm >= 1 && mm <= 12) {
        byMonthExp[mm] = pt.expense !== undefined ? Number(pt.expense) : 0.0;
      }
    }
    const expMonths = [];
    for (let m = 1; m <= 12; m++) {
      expMonths.push(money2(byMonthExp[m] !== undefined ? byMonthExp[m] : 0.0));
    }

    // Оплата за год.
    const pay = await unf.payments(y);
    const payByCustomer = [];
    const pbSrc = Array.isArray(pay.byCustomer) ? pay.byCustomer : [];
    for (const c of pbSrc) {
      payByCustomer.push({
        inn: c.inn !== undefined ? String(c.inn) : '',
        name: c.name !== undefined ? String(c.name) : '',
        amount: money2(c.amount !== undefined ? c.amount : 0.0),
      });
    }

    // Официальный ОФР (для сверки). null, если годовой ОФР за год не сдан.
    const ofrRaw = await buh.regulatoryOfr(y);
    let ofr = null;
    if (ofrRaw !== null) {
      // Порядок ключей строго как в App.php: 2110,2120,2210,2220,2200,period,ref.
      ofr = new Map();
      ofr.set('2110', money2(ofrRaw['2110'] !== undefined ? ofrRaw['2110'] : 0.0));
      ofr.set('2120', money2(ofrRaw['2120'] !== undefined ? ofrRaw['2120'] : 0.0));
      ofr.set('2210', money2(ofrRaw['2210'] !== undefined ? ofrRaw['2210'] : 0.0));
      ofr.set('2220', money2(ofrRaw['2220'] !== undefined ? ofrRaw['2220'] : 0.0));
      ofr.set('2200', money2(ofrRaw['2200'] !== undefined ? ofrRaw['2200'] : 0.0));
      ofr.set('period', ofrRaw.period !== undefined ? String(ofrRaw.period) : '');
      ofr.set('ref', ofrRaw.ref !== undefined ? String(ofrRaw.ref) : '');
    }

    yearsOut.set(String(y), {
      shipTotal: money2(shipTotal),
      shipMonths,
      expense: money2(econ.expense !== undefined ? econ.expense : 0.0),
      expMonths,
      receivable: money2(econ.receivable !== undefined ? econ.receivable : 0.0),
      payable: money2(econ.payable !== undefined ? econ.payable : 0.0),
      payTotal: money2(pay.total !== undefined ? pay.total : 0.0),
      payByCustomer,
      revenueNet: money2(econ.revenue !== undefined ? econ.revenue : 0.0),
      ofr,
    });
  }

  return {
    meta: {
      generatedAt,
      reportYears: years.map((y) => parseInt(y, 10)),
      defaultYear: config.reportYear(),
      org: 'СМАРТ ООО',
      inn: '9727079722',
      schema: 1,
    },
    block1: { rows },
    years: yearsOut,
  };
}

/**
 * ВидОперации для Блока 3: реквизит на Document_РасходнаяНакладная отсутствует —
 * фильтр вызывал HTTP 400. Возвращаем null (все проведённые расходные за год).
 */
function vidOperatsii() {
  return null;
}
