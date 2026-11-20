/**
 * NSE trading-calendar helpers shared by the worker API and the journal page.
 *
 * DEFAULT_NSE_DAYS is the curated 100-day calendar that ships with the journal.
 * Days absent from it on a weekday (e.g. 2026-11-24) are treated as known
 * market holidays. Dates beyond that curated range can only be weekdays —
 * future exchange holiday notifications are not available offline.
 */

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const ONE_DAY = 24 * 60 * 60 * 1000;

export const DEFAULT_NSE_DAYS = [{"trade": 1, "date": "2026-11-13", "day": "Friday"}, {"trade": 2, "date": "2026-11-16", "day": "Monday"}, {"trade": 3, "date": "2026-11-17", "day": "Tuesday"}, {"trade": 4, "date": "2026-11-18", "day": "Wednesday"}, {"trade": 5, "date": "2026-11-19", "day": "Thursday"}, {"trade": 6, "date": "2026-11-20", "day": "Friday"}, {"trade": 7, "date": "2026-11-23", "day": "Monday"}, {"trade": 8, "date": "2026-11-25", "day": "Wednesday"}, {"trade": 9, "date": "2026-11-26", "day": "Thursday"}, {"trade": 10, "date": "2026-11-27", "day": "Friday"}, {"trade": 11, "date": "2026-11-30", "day": "Monday"}, {"trade": 12, "date": "2026-12-01", "day": "Tuesday"}, {"trade": 13, "date": "2026-12-02", "day": "Wednesday"}, {"trade": 14, "date": "2026-12-03", "day": "Thursday"}, {"trade": 15, "date": "2026-12-04", "day": "Friday"}, {"trade": 16, "date": "2026-12-07", "day": "Monday"}, {"trade": 17, "date": "2026-12-08", "day": "Tuesday"}, {"trade": 18, "date": "2026-12-09", "day": "Wednesday"}, {"trade": 19, "date": "2026-12-10", "day": "Thursday"}, {"trade": 20, "date": "2026-12-11", "day": "Friday"}, {"trade": 21, "date": "2026-12-14", "day": "Monday"}, {"trade": 22, "date": "2026-12-15", "day": "Tuesday"}, {"trade": 23, "date": "2026-12-16", "day": "Wednesday"}, {"trade": 24, "date": "2026-12-17", "day": "Thursday"}, {"trade": 25, "date": "2026-12-18", "day": "Friday"}, {"trade": 26, "date": "2026-12-21", "day": "Monday"}, {"trade": 27, "date": "2026-12-22", "day": "Tuesday"}, {"trade": 28, "date": "2026-12-23", "day": "Wednesday"}, {"trade": 29, "date": "2026-12-24", "day": "Thursday"}, {"trade": 30, "date": "2026-12-28", "day": "Monday"}, {"trade": 31, "date": "2026-12-29", "day": "Tuesday"}, {"trade": 32, "date": "2026-12-30", "day": "Wednesday"}, {"trade": 33, "date": "2026-12-31", "day": "Thursday"}, {"trade": 34, "date": "2027-01-01", "day": "Friday"}, {"trade": 35, "date": "2027-01-04", "day": "Monday"}, {"trade": 36, "date": "2027-01-05", "day": "Tuesday"}, {"trade": 37, "date": "2027-01-06", "day": "Wednesday"}, {"trade": 38, "date": "2027-01-07", "day": "Thursday"}, {"trade": 39, "date": "2027-01-08", "day": "Friday"}, {"trade": 40, "date": "2027-01-11", "day": "Monday"}, {"trade": 41, "date": "2027-01-12", "day": "Tuesday"}, {"trade": 42, "date": "2027-01-13", "day": "Wednesday"}, {"trade": 43, "date": "2027-01-14", "day": "Thursday"}, {"trade": 44, "date": "2027-01-15", "day": "Friday"}, {"trade": 45, "date": "2027-01-18", "day": "Monday"}, {"trade": 46, "date": "2027-01-19", "day": "Tuesday"}, {"trade": 47, "date": "2027-01-20", "day": "Wednesday"}, {"trade": 48, "date": "2027-01-21", "day": "Thursday"}, {"trade": 49, "date": "2027-01-22", "day": "Friday"}, {"trade": 50, "date": "2027-01-25", "day": "Monday"}, {"trade": 51, "date": "2027-01-27", "day": "Wednesday"}, {"trade": 52, "date": "2027-01-28", "day": "Thursday"}, {"trade": 53, "date": "2027-01-29", "day": "Friday"}, {"trade": 54, "date": "2027-02-01", "day": "Monday"}, {"trade": 55, "date": "2027-02-02", "day": "Tuesday"}, {"trade": 56, "date": "2027-02-03", "day": "Wednesday"}, {"trade": 57, "date": "2027-02-04", "day": "Thursday"}, {"trade": 58, "date": "2027-02-05", "day": "Friday"}, {"trade": 59, "date": "2027-02-08", "day": "Monday"}, {"trade": 60, "date": "2027-02-09", "day": "Tuesday"}, {"trade": 61, "date": "2027-02-10", "day": "Wednesday"}, {"trade": 62, "date": "2027-02-11", "day": "Thursday"}, {"trade": 63, "date": "2027-02-12", "day": "Friday"}, {"trade": 64, "date": "2027-02-15", "day": "Monday"}, {"trade": 65, "date": "2027-02-16", "day": "Tuesday"}, {"trade": 66, "date": "2027-02-17", "day": "Wednesday"}, {"trade": 67, "date": "2027-02-18", "day": "Thursday"}, {"trade": 68, "date": "2027-02-19", "day": "Friday"}, {"trade": 69, "date": "2027-02-22", "day": "Monday"}, {"trade": 70, "date": "2027-02-23", "day": "Tuesday"}, {"trade": 71, "date": "2027-02-24", "day": "Wednesday"}, {"trade": 72, "date": "2027-02-25", "day": "Thursday"}, {"trade": 73, "date": "2027-02-26", "day": "Friday"}, {"trade": 74, "date": "2027-03-01", "day": "Monday"}, {"trade": 75, "date": "2027-03-02", "day": "Tuesday"}, {"trade": 76, "date": "2027-03-03", "day": "Wednesday"}, {"trade": 77, "date": "2027-03-04", "day": "Thursday"}, {"trade": 78, "date": "2027-03-05", "day": "Friday"}, {"trade": 79, "date": "2027-03-08", "day": "Monday"}, {"trade": 80, "date": "2027-03-09", "day": "Tuesday"}, {"trade": 81, "date": "2027-03-11", "day": "Thursday"}, {"trade": 82, "date": "2027-03-12", "day": "Friday"}, {"trade": 83, "date": "2027-03-15", "day": "Monday"}, {"trade": 84, "date": "2027-03-16", "day": "Tuesday"}, {"trade": 85, "date": "2027-03-17", "day": "Wednesday"}, {"trade": 86, "date": "2027-03-18", "day": "Thursday"}, {"trade": 87, "date": "2027-03-19", "day": "Friday"}, {"trade": 88, "date": "2027-03-23", "day": "Tuesday"}, {"trade": 89, "date": "2027-03-24", "day": "Wednesday"}, {"trade": 90, "date": "2027-03-25", "day": "Thursday"}, {"trade": 91, "date": "2027-03-29", "day": "Monday"}, {"trade": 92, "date": "2027-03-30", "day": "Tuesday"}, {"trade": 93, "date": "2027-03-31", "day": "Wednesday"}, {"trade": 94, "date": "2027-04-01", "day": "Thursday"}, {"trade": 95, "date": "2027-04-02", "day": "Friday"}, {"trade": 96, "date": "2027-04-05", "day": "Monday"}, {"trade": 97, "date": "2027-04-06", "day": "Tuesday"}, {"trade": 98, "date": "2027-04-07", "day": "Wednesday"}, {"trade": 99, "date": "2027-04-08", "day": "Thursday"}, {"trade": 100, "date": "2027-04-09", "day": "Friday"}];

export function parseISODate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error(`Invalid ISO date: ${iso}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

export function toISODate(date) {
  return date.toISOString().slice(0, 10);
}

export function nextMondayISO(fromISO) {
  const base = parseISODate(fromISO);
  const delta = ((8 - base.getUTCDay()) % 7) || 7; // strictly after "from"
  return toISODate(new Date(base.getTime() + delta * ONE_DAY));
}

export function knownMarketHolidays(days = DEFAULT_NSE_DAYS) {
  const trading = new Set(days.map((d) => d.date));
  const holidays = new Set();
  let cursor = parseISODate(days[0].date);
  const end = parseISODate(days[days.length - 1].date);
  while (cursor <= end) {
    const wd = cursor.getUTCDay();
    if (wd !== 0 && wd !== 6 && !trading.has(toISODate(cursor))) holidays.add(toISODate(cursor));
    cursor = new Date(cursor.getTime() + ONE_DAY);
  }
  return holidays;
}

/** Count trading days (Mon–Fri minus known holidays) starting at fromISO. */
export function getNextTradingDays(count = 100, fromISO) {
  const start = fromISO || nextMondayISO(toISODate(new Date()));
  const holidays = knownMarketHolidays();
  const days = [];
  let cursor = parseISODate(start);
  while (days.length < count) {
    const wd = cursor.getUTCDay();
    const iso = toISODate(cursor);
    if (wd !== 0 && wd !== 6 && !holidays.has(iso)) {
      days.push({ trade: days.length + 1, date: iso, day: DAY_NAMES[wd] });
    }
    cursor = new Date(cursor.getTime() + ONE_DAY);
  }
  return { start, days };
}
