// Block3\ShipmentsService — порт web/src/Block3/ShipmentsService.php.
// Расходные накладные по месяцам + total за год.

export class ShipmentsService {
  constructor(repo, year, vidOperatsii) {
    this.repo = repo;
    this.year = year;
    this.vidOperatsii = vidOperatsii;
  }

  async build() {
    const months = {};
    for (let m = 1; m <= 12; m++) {
      months[m] = 0.0;
    }

    let total = 0.0;

    const rows = await this.repo.shipments(this.year, this.vidOperatsii);

    for (const row of rows) {
      if (row.Date === undefined || row.СуммаДокумента === undefined) {
        continue;
      }
      const month = monthFromIsoDate(String(row.Date));
      if (month === null) {
        continue;
      }
      const amount = Number(row.СуммаДокумента);
      months[month] += amount;
      total += amount;
    }

    return { months, total };
  }
}

/** Номер месяца (1..12) из ISO-даты "YYYY-MM-DD"/"YYYY-MM-DDThh:mm:ss" или null. */
function monthFromIsoDate(isoDate) {
  if (isoDate.length < 7) {
    return null;
  }
  if (isoDate.charAt(4) !== '-' || isoDate.charAt(7) !== '-') {
    return null;
  }
  const monthPart = isoDate.substring(5, 7);
  if (!/^[0-9]+$/.test(monthPart)) {
    return null;
  }
  const month = parseInt(monthPart, 10);
  if (month < 1 || month > 12) {
    return null;
  }
  return month;
}
