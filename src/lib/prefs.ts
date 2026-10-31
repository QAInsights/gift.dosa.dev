import { AuthError } from "./auth";
import { findPrefs, findUserById, updateUserName, upsertPrefs, type Db } from "./db";
import type { DateFormat } from "./format";

export const REGIONS = [
  { code: "US", label: "United States" },
  { code: "UK", label: "United Kingdom" },
  { code: "IN", label: "India" },
] as const;

export const CURRENCIES = [
  { code: "USD", label: "US dollar ($)" },
  { code: "GBP", label: "British pound (£)" },
  { code: "EUR", label: "Euro (€)" },
  { code: "INR", label: "Indian rupee (₹)" },
] as const;

export const DATE_FORMAT_OPTIONS: { code: DateFormat; label: string }[] = [
  { code: "MDY", label: "May 3, 2027" },
  { code: "DMY", label: "3 May 2027" },
  { code: "ISO", label: "2027-05-03" },
];

export interface Prefs {
  region: string;
  currency: string;
  dateFormat: DateFormat;
}

export const DEFAULT_PREFS: Prefs = { region: "US", currency: "USD", dateFormat: "MDY" };

const REGION_CODES: ReadonlySet<string> = new Set(REGIONS.map((r) => r.code));
const CURRENCY_CODES: ReadonlySet<string> = new Set(CURRENCIES.map((c) => c.code));
const DATE_FORMATS = new Set<string>(DATE_FORMAT_OPTIONS.map((o) => o.code));

export interface PrefsInput {
  region?: unknown;
  currency?: unknown;
  date_format?: unknown;
  dateFormat?: unknown;
}

export function normalizePrefs(raw: PrefsInput): Prefs {
  let region = DEFAULT_PREFS.region;
  if (raw.region !== undefined && raw.region !== null && raw.region !== "") {
    if (typeof raw.region !== "string" || !REGION_CODES.has(raw.region.trim().toUpperCase())) {
      throw new AuthError(400, "Pick one of the listed regions.");
    }
    region = raw.region.trim().toUpperCase();
  }
  let currency = DEFAULT_PREFS.currency;
  if (raw.currency !== undefined && raw.currency !== null && raw.currency !== "") {
    if (typeof raw.currency !== "string" || !CURRENCY_CODES.has(raw.currency.trim().toUpperCase())) {
      throw new AuthError(400, "Pick one of the listed currencies.");
    }
    currency = raw.currency.trim().toUpperCase();
  }
  const rawFormat = raw.date_format ?? raw.dateFormat;
  let dateFormat: DateFormat = DEFAULT_PREFS.dateFormat;
  if (rawFormat !== undefined && rawFormat !== null && rawFormat !== "") {
    if (typeof rawFormat !== "string" || !DATE_FORMATS.has(rawFormat.trim().toUpperCase())) {
      throw new AuthError(400, "Pick one of the date formats.");
    }
    dateFormat = rawFormat.trim().toUpperCase() as DateFormat;
  }
  return { region, currency, dateFormat };
}

export function normalizeName(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") throw new AuthError(400, "Enter your name as text.");
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length > 80) throw new AuthError(400, "Keep the name under 81 characters.");
  return name.length === 0 ? null : name;
}

export async function getPrefs(db: Db, userId: string): Promise<Prefs> {
  const row = await findPrefs(db, userId);
  if (!row) return { ...DEFAULT_PREFS };
  const region = row.region && REGION_CODES.has(row.region.toUpperCase()) ? row.region.toUpperCase() : DEFAULT_PREFS.region;
  const currency =
    row.currency && CURRENCY_CODES.has(row.currency.toUpperCase()) ? row.currency.toUpperCase() : DEFAULT_PREFS.currency;
  const dateFormat =
    row.date_format && DATE_FORMATS.has(row.date_format.toUpperCase())
      ? (row.date_format.toUpperCase() as DateFormat)
      : DEFAULT_PREFS.dateFormat;
  return { region, currency, dateFormat };
}

export interface ProfileInput extends PrefsInput {
  name?: unknown;
}

export async function updateProfile(
  db: Db,
  userId: string,
  input: ProfileInput,
  now = Date.now(),
): Promise<{ name: string | null; prefs: Prefs }> {
  const user = await findUserById(db, userId);
  if (!user) throw new AuthError(404, "That account is not on file.");
  const name = input.name === undefined ? user.name : normalizeName(input.name);
  const current = await getPrefs(db, userId);
  const rawFormat = input.date_format !== undefined ? input.date_format : input.dateFormat;
  const prefs = normalizePrefs({
    region: input.region !== undefined ? input.region : current.region,
    currency: input.currency !== undefined ? input.currency : current.currency,
    date_format: rawFormat !== undefined ? rawFormat : current.dateFormat,
  });
  if (name !== user.name) await updateUserName(db, userId, name, now);
  await upsertPrefs(db, {
    user_id: userId,
    region: prefs.region,
    currency: prefs.currency,
    date_format: prefs.dateFormat,
    updated_at: now,
  });
  return { name, prefs };
}
