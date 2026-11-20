import { describe, expect, it } from "vitest";
import {
  DEFAULT_NSE_DAYS,
  getNextTradingDays,
  knownMarketHolidays,
  nextMondayISO,
  parseISODate,
  toISODate,
} from "../worker/src/trading_days.js";

describe("nextMondayISO", () => {
  it("returns the following Monday for a weekday", () => {
    expect(nextMondayISO("2026-11-20")).toBe("2026-11-23"); // Friday
    expect(nextMondayISO("2026-11-23")).toBe("2026-11-30"); // Monday -> next week
    expect(nextMondayISO("2026-11-22")).toBe("2026-11-23"); // Sunday
  });

  it("never returns the same day", () => {
    for (let i = 0; i < 7; i++) {
      const from = toISODate(new Date(Date.UTC(2026, 10, 18 + i)));
      expect(nextMondayISO(from)).not.toBe(from);
      expect(parseISODate(nextMondayISO(from)).getUTCDay()).toBe(1);
    }
  });
});

describe("getNextTradingDays", () => {
  it("produces 100 numbered weekdays starting at the requested date", () => {
    const { start, days } = getNextTradingDays(100, "2026-11-23");
    expect(start).toBe("2026-11-23");
    expect(days).toHaveLength(100);
    expect(days[0]).toEqual({ trade: 1, date: "2026-11-23", day: "Monday" });
    days.forEach((d, i) => {
      expect(d.trade).toBe(i + 1);
      expect([1, 2, 3, 4, 5]).toContain(parseISODate(d.date).getUTCDay());
      expect(d.day).toBe(
        ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][
          parseISODate(d.date).getUTCDay()
        ],
      );
    });
    expect(new Set(days.map((d) => d.date)).size).toBe(100);
  });

  it("skips the market holidays encoded in the shipped calendar", () => {
    const holidays = knownMarketHolidays();
    expect(holidays.has("2026-11-24")).toBe(true);
    const { days } = getNextTradingDays(100, "2026-11-23");
    const dates = new Set(days.map((d) => d.date));
    [...holidays].forEach((iso) => expect(dates.has(iso)).toBe(false));
    expect(dates.has("2026-11-25")).toBe(true);
  });

  it("defaults to next Monday when no start is given", () => {
    const { start, days } = getNextTradingDays(3);
    expect(start).toBe(nextMondayISO(toISODate(new Date())));
    expect(days.map((d) => d.date)).toEqual([start, ...days.slice(1).map((d) => d.date)]);
    expect(days[0].date).toBe(start);
  });

  it("matches the seeded calendar when restarted from its first day", () => {
    const { days } = getNextTradingDays(DEFAULT_NSE_DAYS.length, DEFAULT_NSE_DAYS[0].date);
    expect(days).toEqual(DEFAULT_NSE_DAYS);
  });
});

describe("parseISODate", () => {
  it("rejects malformed dates", () => {
    expect(() => parseISODate("23-11-2026")).toThrow(/Invalid ISO date/);
  });
});
