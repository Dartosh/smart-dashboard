// Block1\ContractsService — порт web/src/Block1/ContractsService.php.
// Портфель госконтрактов: фильтр по извлекаемому regnum, опц. группировка по
// регистровому номеру, merge reestr, byCustomer по ИНН, статусы.

import { RegNumber } from './regnum.mjs';
import { normalizeStatus } from './unf.mjs';

export class ContractsService {
  constructor(repo, groupByRegnum) {
    this.repo = repo;
    this.groupByRegnum = groupByRegnum;
  }

  async build() {
    const orders = await this.repo.orders();
    const contractors = await this.repo.contractorsMap();
    const statuses = await this.repo.statusesMap();
    const reestrMap = await this.repo.reestrByContract();

    const rawRows = [];
    for (const order of orders) {
      const osnovanie = order.ОснованиеПечати !== undefined ? String(order.ОснованиеПечати) : '';
      const regnum = RegNumber.extract(osnovanie);
      if (regnum === null) {
        continue;
      }

      const amount = order.СуммаДокумента !== undefined ? Number(order.СуммаДокумента) : 0.0;
      const dateRaw = order.Date !== undefined ? order.Date : '';
      const date = String(dateRaw).substring(0, 10);

      const contractorKey = order.Контрагент_Key !== undefined ? String(order.Контрагент_Key) : '';
      let name = '';
      let inn = '';
      if (contractorKey !== '' && contractors[contractorKey] !== undefined) {
        const card = contractors[contractorKey];
        name = card.name !== undefined ? String(card.name) : '';
        inn = card.inn !== undefined ? String(card.inn) : '';
      }

      const statusGuid = order.СостояниеЗаказа !== undefined ? String(order.СостояниеЗаказа) : '';
      let status = '—';
      if (statusGuid !== '' && statuses[statusGuid] !== undefined) {
        status = normalizeStatus(String(statuses[statusGuid]));
      }

      rawRows.push({
        regnum,
        reestr: reestrMap[regnum] !== undefined ? reestrMap[regnum] : null,
        date,
        customer: name,
        inn,
        status,
        amount,
      });
    }

    const rows = this.groupByRegnum ? groupRows(rawRows) : rawRows;

    let total = 0.0;
    for (const row of rows) {
      total += row.amount;
    }

    const byCustomer = aggregateByCustomer(rows);

    const statusList = [];
    for (const row of rows) {
      if (!statusList.includes(row.status)) {
        statusList.push(row.status);
      }
    }

    return {
      rows,
      total,
      byCustomer,
      statuses: statusList,
    };
  }
}

/**
 * Группировка по regnum: сумма; date/status — от самого позднего заказа
 * (строго-больше по строке date, при равенстве — первый увиденный). Customer/inn
 * от первого вхождения. Порядок — порядок первого появления regnum.
 */
function groupRows(rawRows) {
  const grouped = {};
  const order = [];
  for (const row of rawRows) {
    const key = row.regnum;
    if (grouped[key] === undefined) {
      grouped[key] = { ...row };
      order.push(key);
      continue;
    }
    grouped[key].amount += row.amount;
    if (strcmpStr(row.date, grouped[key].date) > 0) {
      grouped[key].date = row.date;
      grouped[key].status = row.status;
    }
  }
  return order.map((key) => grouped[key]);
}

/** Агрегат по ИНН: имя — от первой строки; порядок — первого появления ИНН. */
function aggregateByCustomer(rows) {
  const byInn = {};
  const order = [];
  for (const row of rows) {
    const inn = row.inn;
    if (byInn[inn] === undefined) {
      byInn[inn] = { inn, name: row.customer, amount: 0.0 };
      order.push(inn);
    }
    byInn[inn].amount += row.amount;
  }
  return order.map((inn) => byInn[inn]);
}

/** strcmp для дат YYYY-MM-DD: лексикографически (ASCII) — байтовое сравнение. */
function strcmpStr(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
