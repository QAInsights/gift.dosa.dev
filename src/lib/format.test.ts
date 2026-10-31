import { describe, expect, it } from "vitest";
import { formatDate, formatMoney, formatTotals, plural } from "./format";

describe("format", () => {
  it("formats money, dates, and counts", () => {
    expect(formatMoney(1250)).toBe("$12.50");
    expect(formatMoney(1250, "EUR")).toBe("€12.50");
    expect(formatMoney(1250, "TOOLONG")).toBe("12.50 TOOLONG");
    expect(formatDate("2027-05-03")).toBe("May 3, 2027");
    expect(plural(1, "card", "cards")).toBe("1 card");
    expect(plural(4, "card", "cards")).toBe("4 cards");
  });

  it("joins per-currency totals in code order", () => {
    expect(formatTotals({})).toBe("$0.00");
    expect(formatTotals({ USD: 1250 })).toBe("$12.50");
    expect(formatTotals({ USD: 1250, EUR: 800 })).toBe("€8.00 · $12.50");
  });
});
