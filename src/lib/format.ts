export function formatMoney(cents: number, currency = "USD"): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

export type DateFormat = "MDY" | "DMY" | "ISO";

export function formatDate(ymd: string, dateFormat: DateFormat = "MDY"): string {
  if (dateFormat === "ISO") return ymd;
  const [y, m, d] = ymd.split("-").map(Number);
  return new Intl.DateTimeFormat(dateFormat === "DMY" ? "en-GB" : "en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function formatTotals(totals: Record<string, number>): string {
  const entries = Object.entries(totals).sort(([a], [b]) => (a < b ? -1 : 1));
  if (entries.length === 0) return formatMoney(0);
  return entries.map(([currency, cents]) => formatMoney(cents, currency)).join(" · ");
}
