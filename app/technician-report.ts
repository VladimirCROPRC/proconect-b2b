import { estimateTotal } from "./estimate-values";
export const reportTimezone = "Europe/Bucharest";
export function localDate(timestamp: number) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: reportTimezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(timestamp);
  const part = (type: string) => parts.find(value => value.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function dayStart(date: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const target = Date.parse(date + "T00:00:00Z");
  if (!Number.isFinite(target) || new Date(target).toISOString().slice(0, 10) !== date) return null;
  let guess = target;
  const formatter = new Intl.DateTimeFormat("en-GB", { timeZone: reportTimezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  for (let i = 0; i < 3; i++) {
    const parts = formatter.formatToParts(guess);
    const get = (type: string) => Number(parts.find(part => part.type === type)?.value);
    const actual = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
    guess += target - actual;
  }
  return guess;
}
export function reportRange(from: string, to: string) {
  const start = dayStart(from), endDay = dayStart(to);
  if (start === null || endDay === null || start > endDay) return null;
  const next = new Date(Date.parse(to + "T00:00:00Z") + 86_400_000).toISOString().slice(0, 10);
  return { start, end: dayStart(next)! };
}

export function savedEstimateTotal(content: string | null): number | null {
  if (!content) return null;
  try {
    const rows = JSON.parse(content);
    if (!Array.isArray(rows) || !rows.length) return null;

    const ids = new Set();
    for (const row of rows) {
      if (!row || typeof row.id !== "string" || ids.has(row.id)
        || typeof row.quantity !== "number" || !Number.isFinite(row.quantity) || row.quantity <= 0
        || typeof row.unitPrice !== "number" || !Number.isFinite(row.unitPrice) || row.unitPrice < 0) return null;
      ids.add(row.id);

    }
    const total = estimateTotal(rows);
    return Number.isSafeInteger(Math.round(total * 100)) ? total : null;
  } catch { return null; }
}

export type TechnicianReport = {
  technician: { username: string; name: string };
  from: string;
  to: string;
  works: Array<{ id: string; client: string; address: string; activityType: string; createdAt: number; total: number | null; estimateStatus: "salvat" | "lipsă" | "invalid" }>;
  total: number;
  missingEstimates: number;
  undated: Array<{ id: string; client: string }>;
};
