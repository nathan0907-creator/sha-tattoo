'use strict';

// Repris du site de L'atelier de Cyrille : les jours fériés de France métropolitaine.

const { addDays, pad2 } = require('./time');

/** Dimanche de Pâques d'une année, « AAAA-MM-JJ » (calcul de Meeus pour le calendrier grégorien). */
function easter(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** Les onze jours fériés de France métropolitaine pour une année, dans l'ordre du calendrier. */
function holidaysOf(year) {
  const sunday = easter(year);
  return [
    [`${year}-01-01`, "Jour de l'An"],
    [addDays(sunday, 1), 'Lundi de Pâques'],
    [`${year}-05-01`, 'Fête du Travail'],
    [`${year}-05-08`, 'Victoire de 1945'],
    [addDays(sunday, 39), 'Ascension'],
    [addDays(sunday, 50), 'Lundi de Pentecôte'],
    [`${year}-07-14`, 'Fête nationale'],
    [`${year}-08-15`, 'Assomption'],
    [`${year}-11-01`, 'Toussaint'],
    [`${year}-11-11`, 'Armistice de 1918'],
    [`${year}-12-25`, 'Noël'],
  ].map(([date, name]) => ({ date, name })).sort((x, y) => x.date.localeCompare(y.date));
}

/** Les jours fériés entre deux dates incluses. */
function holidaysBetween(from, to) {
  const list = [];
  for (let year = Number(from.slice(0, 4)); year <= Number(to.slice(0, 4)); year++) {
    list.push(...holidaysOf(year).filter((day) => day.date >= from && day.date <= to));
  }
  return list;
}

module.exports = { easter, holidaysOf, holidaysBetween };
