// Block2\EconomicsService — порт web/src/Block2/EconomicsService.php.
//
// Динамическая классификация листьев 90.xx по префиксу кода:
//   90.01.* -> 'rev' (выручка, Кт),
//   90.02/90.07/90.08.* -> 'exp' (расход, Дт),
//   90.03/90.04/90.05.* -> 'sub' (вычитается из выручки, Дт),
//   прочее (90.09 и т.п.) -> игнор.
// Доход = Кт(rev) − Дт(sub); расход = Дт(exp); помесячно 12 точек. ДЗ/КЗ из
// balance по листьям 60/62/76 (классификация по знаку строки).

const ACCOUNTS_60 = [
  '2e0156a0-4bd1-11ef-a9f7-adf91a234dd1', // 60.01
  '2e0156a1-4bd1-11ef-a9f7-adf91a234dd1', // 60.02
  '2e0156a2-4bd1-11ef-a9f7-adf91a234dd1', // 60.03
  '2e0156a3-4bd1-11ef-a9f7-adf91a234dd1', // 60.21
  '2e0156a4-4bd1-11ef-a9f7-adf91a234dd1', // 60.22
  '2e0156a5-4bd1-11ef-a9f7-adf91a234dd1', // 60.31
  '2e0156a6-4bd1-11ef-a9f7-adf91a234dd1', // 60.32
];

const ACCOUNTS_62 = [
  '2e0156a8-4bd1-11ef-a9f7-adf91a234dd1', // 62.01
  '2e0156a9-4bd1-11ef-a9f7-adf91a234dd1', // 62.02
  '2e0156aa-4bd1-11ef-a9f7-adf91a234dd1', // 62.03
  '2e0156ab-4bd1-11ef-a9f7-adf91a234dd1', // 62.21
  '2e0156ac-4bd1-11ef-a9f7-adf91a234dd1', // 62.22
  '2e0156ad-4bd1-11ef-a9f7-adf91a234dd1', // 62.31
  '2e0156ae-4bd1-11ef-a9f7-adf91a234dd1', // 62.32
  '2e0156b0-4bd1-11ef-a9f7-adf91a234dd1', // 62.ОТ.1
  '2e0156b1-4bd1-11ef-a9f7-adf91a234dd1', // 62.ОТ.2
  '2e0156b2-4bd1-11ef-a9f7-adf91a234dd1', // 62.ОТ.3
  '2e0156b3-4bd1-11ef-a9f7-adf91a234dd1', // 62.Р
];

const ACCOUNTS_76_TRADE = [
  '2e01571d-4bd1-11ef-a9f7-adf91a234dd1', // 76.05
  '2e01571e-4bd1-11ef-a9f7-adf91a234dd1', // 76.06
  '2e015725-4bd1-11ef-a9f7-adf91a234dd1', // 76.09
];

export class EconomicsService {
  constructor(repo, year) {
    this.repo = repo;
    this.year = year;
  }

  roleForCode(code) {
    if (code.startsWith('90.01')) return 'rev';
    if (code.startsWith('90.02') || code.startsWith('90.07') || code.startsWith('90.08')) return 'exp';
    if (code.startsWith('90.03') || code.startsWith('90.04') || code.startsWith('90.05')) return 'sub';
    return null;
  }

  roleMap(leaves) {
    const roles = {};
    for (const leaf of leaves) {
      const role = this.roleForCode(leaf.code);
      if (role !== null) {
        roles[leaf.ref] = role;
      }
    }
    return roles;
  }

  async build() {
    const yearStart = this.year + '-01-01';
    const yearEnd = (this.year + 1) + '-01-01';

    const leaves = await this.repo.chartLeafAccounts('90');
    const roleByRef = this.roleMap(leaves);
    const plAccounts = Object.keys(roleByRef);

    const yearRows = await this.repo.turnovers(plAccounts, yearStart, yearEnd);
    const revenue = revenueFromRows(yearRows, roleByRef);
    const expense = expenseFromRows(yearRows, roleByRef);
    const profit = revenue - expense;

    let margin = null;
    if (revenue > 0) {
      margin = profit / revenue;
    }

    const monthly = [];
    for (let m = 1; m <= 12; m++) {
      const monthStart = monthStartIso(this.year, m);
      const monthEnd = monthStartIso(m === 12 ? this.year + 1 : this.year, m === 12 ? 1 : m + 1);
      const mRows = await this.repo.turnovers(plAccounts, monthStart, monthEnd);
      const mRevenue = revenueFromRows(mRows, roleByRef);
      const mExpense = expenseFromRows(mRows, roleByRef);
      monthly.push({
        month: m,
        revenue: mRevenue,
        expense: mExpense,
        profit: mRevenue - mExpense,
      });
    }

    // ДЗ/КЗ из сальдо на начало REPORT_YEAR+1 (остаток на 31.12).
    const balanceMoment = (this.year + 1) + '-01-01';
    let receivable = 0.0;
    let payable = 0.0;
    const accountSets = [ACCOUNTS_60, ACCOUNTS_62, ACCOUNTS_76_TRADE];
    for (const leafKeys of accountSets) {
      const rows = await this.repo.balance(leafKeys, balanceMoment);
      for (const row of rows) {
        const dr = num(row, 'СуммаBalanceDr');
        const cr = num(row, 'СуммаBalanceCr');
        if (dr > 0) receivable += dr;
        if (cr > 0) payable += cr;
      }
    }

    return {
      revenue,
      expense,
      profit,
      margin,
      receivable,
      payable,
      monthly,
    };
  }
}

function revenueFromRows(rows, roleByRef) {
  let cr = 0.0;
  let dr = 0.0;
  for (const row of rows) {
    const acc = str(row, 'Account_Key');
    if (acc === '' || roleByRef[acc] === undefined) {
      continue;
    }
    const role = roleByRef[acc];
    if (role === 'rev') {
      cr += num(row, 'СуммаTurnoverCr');
    } else if (role === 'sub') {
      dr += num(row, 'СуммаTurnoverDr');
    }
  }
  return cr - dr;
}

function expenseFromRows(rows, roleByRef) {
  let dr = 0.0;
  for (const row of rows) {
    const acc = str(row, 'Account_Key');
    if (acc !== '' && roleByRef[acc] === 'exp') {
      dr += num(row, 'СуммаTurnoverDr');
    }
  }
  return dr;
}

function monthStartIso(year, month) {
  return year + '-' + String(month).padStart(2, '0') + '-01';
}

function num(row, key) {
  if (row[key] === undefined) return 0.0;
  return Number(row[key]);
}

function str(row, key) {
  if (row[key] === undefined) return '';
  return String(row[key]);
}
