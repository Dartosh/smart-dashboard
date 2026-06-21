// Source\UnfRepository — порт web/src/Source/UnfRepository.php (1С:УНФ).

import { RegNumber } from './regnum.mjs';

/** Support\Text::normalizeStatus — trim + схлопывание пробельных символов. */
export function normalizeStatus(s) {
  // NBSP (U+00A0) → пробел, затем любая последовательность \s → один пробел.
  s = s.replace(/ /g, ' ');
  s = s.replace(/\s+/gu, ' ');
  return s.trim();
}

export class UnfRepository {
  constructor(client, orgGuid) {
    this.client = client;
    this.orgGuid = orgGuid;
  }

  /** Заказы покупателя (Блок 1): весь портфель, без фильтра по дате. */
  async orders() {
    const filter = "Posted eq true and Организация_Key eq guid'" + this.orgGuid + "'";
    return this.client.getCollection('Document_ЗаказПокупателя', {
      '$format': 'json',
      '$select': 'Number,Date,СуммаДокумента,ОснованиеПечати,Контрагент_Key,СостояниеЗаказа,Ref_Key',
      '$filter': filter,
      '$orderby': 'Date desc',
    });
  }

  /**
   * Оплата за год: оборот по AccumulationRegister_ОплатаСчетовИЗаказов/Turnovers.
   * Оплата по строке = СуммаОплатыTurnover + СуммаАвансаTurnover.
   * Только клиентские документы; total авторитетен; byCustomer по ИНН.
   * @param {number} year
   */
  async payments(year) {
    const path = "AccumulationRegister_ОплатаСчетовИЗаказов/Turnovers(StartPeriod=datetime'"
      + year + "-01-01T00:00:00',EndPeriod=datetime'" + (year + 1) + "-01-01T00:00:00')";
    const rows = await this.client.callFunction(path, {
      '$format': 'json',
      '$filter': "Организация_Key eq guid'" + this.orgGuid + "'",
    });

    const customerTypes = [
      'StandardODATA.Document_ЗаказПокупателя',
      'StandardODATA.Document_СчетНаОплату',
    ];

    // Карта Ref_Key заказа → Контрагент_Key.
    const orderMap = {};
    for (const order of await this.orders()) {
      if (order.Ref_Key === undefined) {
        continue;
      }
      orderMap[String(order.Ref_Key)] = order.Контрагент_Key !== undefined
        ? String(order.Контрагент_Key) : '';
    }

    // Карта Ref_Key счёта на оплату → Контрагент_Key.
    const invoiceMap = {};
    const invoiceRows = await this.client.getCollection('Document_СчетНаОплату', {
      '$format': 'json',
      '$select': 'Ref_Key,Контрагент_Key',
      '$filter': "Организация_Key eq guid'" + this.orgGuid + "'",
    });
    for (const inv of invoiceRows) {
      if (inv.Ref_Key === undefined) {
        continue;
      }
      invoiceMap[String(inv.Ref_Key)] = inv.Контрагент_Key !== undefined
        ? String(inv.Контрагент_Key) : '';
    }

    const contractors = await this.contractorsMap();

    let total = 0.0;
    const byInn = {};
    const orderArr = [];

    for (const row of rows) {
      const type = row.СчетНаОплату_Type !== undefined ? String(row.СчетНаОплату_Type) : '';
      if (!customerTypes.includes(type)) {
        continue;
      }

      let oplata = row.СуммаОплатыTurnover !== undefined ? Number(row.СуммаОплатыTurnover) : 0.0;
      oplata += row.СуммаАвансаTurnover !== undefined ? Number(row.СуммаАвансаTurnover) : 0.0;

      total += oplata;

      if (oplata === 0.0) {
        continue;
      }

      const docRef = row.СчетНаОплату !== undefined ? String(row.СчетНаОплату) : '';
      let contractorKey = '';
      if (docRef !== '' && orderMap[docRef] !== undefined) {
        contractorKey = orderMap[docRef];
      } else if (docRef !== '' && invoiceMap[docRef] !== undefined) {
        contractorKey = invoiceMap[docRef];
      }

      if (contractorKey === '' || contractors[contractorKey] === undefined) {
        continue;
      }

      const card = contractors[contractorKey];
      const name = card.name !== undefined ? String(card.name) : '';
      const inn = card.inn !== undefined ? String(card.inn) : '';

      if (byInn[inn] === undefined) {
        byInn[inn] = { inn, name, amount: 0.0 };
        orderArr.push(inn);
      }
      byInn[inn].amount += oplata;
    }

    const byCustomer = orderArr.map((inn) => byInn[inn]);
    // Сортировка по убыванию суммы (стабильная — как usort в PHP 8+).
    byCustomer.sort((a, b) => {
      if (a.amount === b.amount) return 0;
      return a.amount < b.amount ? 1 : -1;
    });

    return { total, byCustomer };
  }

  /** Расходные накладные (Блок 3) за год. @param {number} year */
  async shipments(year, vidOperatsii) {
    const start = pad4(year) + '-01-01T00:00:00';
    const end = pad4(year + 1) + '-01-01T00:00:00';

    let filter = "Date ge datetime'" + start + "'"
      + " and Date lt datetime'" + end + "'"
      + ' and Posted eq true'
      + " and Организация_Key eq guid'" + this.orgGuid + "'";

    if (vidOperatsii !== null && vidOperatsii !== undefined) {
      filter += " and ВидОперации eq '" + vidOperatsii + "'";
    }

    return this.client.getCollection('Document_РасходнаяНакладная', {
      '$format': 'json',
      '$select': 'Date,СуммаДокумента',
      '$filter': filter,
    });
  }

  /** Карта контрагентов: Ref_Key → {name, inn}. */
  async contractorsMap() {
    const rows = await this.client.getCollection('Catalog_Контрагенты', {
      '$format': 'json',
      '$select': 'Ref_Key,Description,ИНН',
    });
    const map = {};
    for (const row of rows) {
      if (row.Ref_Key === undefined) continue;
      const name = row.Description !== undefined ? String(row.Description) : '';
      const inn = row.ИНН !== undefined ? String(row.ИНН) : '';
      map[String(row.Ref_Key)] = { name, inn };
    }
    return map;
  }

  /** Карта статусов заказов: Ref_Key → Description. */
  async statusesMap() {
    const rows = await this.client.getCollection('Catalog_СостоянияЗаказовПокупателей', {
      '$format': 'json',
      '$select': 'Ref_Key,Description',
    });
    const map = {};
    for (const row of rows) {
      if (row.Ref_Key === undefined) continue;
      map[String(row.Ref_Key)] = row.Description !== undefined ? String(row.Description) : '';
    }
    return map;
  }

  /**
   * Карта «номер контракта → реестровый номер ЕИС» по ВСЕМ заказам (без Posted).
   * Пара кладётся, только если найдены и contract, и reestr; первое вхождение
   * выигрывает.
   * @returns {Promise<Record<string,string>>}
   */
  async reestrByContract() {
    const filter = "Организация_Key eq guid'" + this.orgGuid + "'"; // NO Posted: реестровый бывает в черновиках
    const rows = await this.client.getCollection('Document_ЗаказПокупателя', {
      '$format': 'json',
      '$select': 'Number,ОснованиеПечати',
      '$filter': filter,
    });
    const map = {};
    for (const row of rows) {
      const osn = row.ОснованиеПечати !== undefined ? String(row.ОснованиеПечати) : '';
      if (osn === '') continue;
      const contract = RegNumber.extract(osn);
      const reestr = RegNumber.extractReestr(osn);
      if (contract === null || reestr === null) continue;
      if (map[contract] === undefined) map[contract] = reestr;
    }
    return map;
  }
}

function pad4(n) {
  // sprintf("%04d", n) — без знака для year (>=0).
  return String(n).padStart(4, '0');
}
