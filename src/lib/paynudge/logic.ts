import type { DisplayStatus, Invoice, InvoiceItem, ReminderTone } from "./types";

const DAY = 86_400_000;

/** Parse YYYY-MM-DD as a UTC midnight timestamp. */
export function isoToMs(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

export function msToIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(iso: string, n: number): string {
  return msToIso(isoToMs(iso) + n * DAY);
}

export function realTodayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Whole days between two dates (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((isoToMs(b) - isoToMs(a)) / DAY);
}

/** Days past the due date; 0 when not late yet. */
export function daysLate(dueDate: string, today: string): number {
  return Math.max(0, daysBetween(dueDate, today));
}

export function displayStatus(inv: Invoice, today: string): DisplayStatus {
  if (inv.status === "paid") return "paid";
  if (inv.status === "cancelled") return "cancelled";
  return daysLate(inv.due_date, today) > 0 ? "late" : "waiting";
}

/**
 * Code picks the tone, not the AI:
 * not late yet → heads-up, 1–3 days late → friendly, 4–10 → polite but clear, more than 10 → firm.
 */
export function toneFor(lateDays: number): ReminderTone {
  if (lateDays <= 0) return "heads-up";
  if (lateDays <= 3) return "friendly";
  if (lateDays <= 10) return "polite-clear";
  return "firm";
}

export const TONE_LABEL: Record<ReminderTone, string> = {
  "heads-up": "Friendly heads-up",
  friendly: "Friendly",
  "polite-clear": "Polite but clear",
  firm: "Firm but respectful",
};

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function itemsTotal(items: InvoiceItem[]): number {
  return round2(items.reduce((sum, i) => sum + i.quantity * i.unit_price, 0));
}

export function formatUsd(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: n % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(n);
}

export function formatDate(iso: string): string {
  return new Date(isoToMs(iso)).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export type WeeklyNumbers = {
  owed: number;
  waitingCount: number;
  paidThisWeek: number;
  expectedThisWeek: number;
  late: { name: string; amount: number; days: number }[];
};

/** All the numbers for the weekly summary. The AI only turns these into sentences. */
export function weeklyNumbers(invoices: Invoice[], today: string): WeeklyNumbers {
  const weekAgo = addDays(today, -7);
  const weekAhead = addDays(today, 7);
  let owed = 0;
  let waitingCount = 0;
  let paidThisWeek = 0;
  let expectedThisWeek = 0;
  const late: WeeklyNumbers["late"] = [];
  for (const inv of invoices) {
    const s = displayStatus(inv, today);
    if (s === "paid") {
      const paidDay = (inv.paid_at ?? "").slice(0, 10);
      if (paidDay && paidDay > weekAgo && paidDay <= today) paidThisWeek += inv.amount;
      continue;
    }
    if (s === "cancelled") continue;
    owed += inv.amount;
    waitingCount += 1;
    if (s === "late")
      late.push({
        name: inv.customer_name,
        amount: inv.amount,
        days: daysLate(inv.due_date, today),
      });
    else if (inv.due_date <= weekAhead) expectedThisWeek += inv.amount;
  }
  late.sort((a, b) => b.days - a.days);
  return {
    owed: round2(owed),
    waitingCount,
    paidThisWeek: round2(paidThisWeek),
    expectedThisWeek: round2(expectedThisWeek),
    late,
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function isEmail(s: string): boolean {
  return EMAIL_RE.test(s.trim());
}

/** Which fields still need the seller's attention before sending. */
export function missingFields(
  form: {
    customer_name: string;
    customer_email: string;
    items: { name: string; quantity: number; unit_price: number | null }[];
    due_date: string;
  },
  today: string,
): string[] {
  const m: string[] = [];
  if (!form.customer_name.trim()) m.push("customer_name");
  if (!isEmail(form.customer_email)) m.push("customer_email");
  if (!form.due_date) m.push("due_date");
  else if (form.due_date < today) m.push("due_date");
  if (form.items.length === 0) m.push("items");
  form.items.forEach((it, i) => {
    if (!it.name.trim()) m.push(`items.${i}.name`);
    if (!(it.quantity > 0)) m.push(`items.${i}.quantity`);
    if (it.unit_price === null || !(it.unit_price > 0)) m.push(`items.${i}.unit_price`);
  });
  return m;
}
