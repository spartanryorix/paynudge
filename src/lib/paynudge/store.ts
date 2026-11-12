import { useSyncExternalStore } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { addDays, realTodayIso } from "./logic";
import type { Invoice, Reminder } from "./types";

/**
 * Account data cache. Invoices, reminders and the demo clock live in Lovable Cloud,
 * scoped to the signed-in account. Writes update this cache first, then save.
 * For PayPal invoices, PayPal stays the source of truth for payment status.
 */
type State = {
  userId: string | null;
  email: string | null;
  displayName: string | null;
  invoices: Invoice[];
  reminders: Reminder[];
  clockOffsetDays: number;
  authReady: boolean;
  loaded: boolean;
};

type InvoiceRow = Database["public"]["Tables"]["invoices"]["Row"];
type ReminderRow = Database["public"]["Tables"]["reminders"]["Row"];

const EMPTY: State = {
  userId: null,
  email: null,
  displayName: null,
  invoices: [],
  reminders: [],
  clockOffsetDays: 0,
  authReady: false,
  loaded: false,
};

let state: State = EMPTY;
let loadToken = 0;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function set(next: (s: State) => State) {
  state = next(state);
  emit();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function useStore(): State & { hydrated: boolean } {
  const s = useSyncExternalStore(
    subscribe,
    () => state,
    () => EMPTY,
  );
  return { ...s, hydrated: s.loaded };
}

export function useToday(): string {
  const { clockOffsetDays } = useStore();
  return addDays(realTodayIso(), clockOffsetDays);
}

export function getState(): State {
  return state;
}

function toInvoice(r: InvoiceRow): Invoice {
  return {
    id: r.id,
    source: r.source as Invoice["source"],
    paypal_invoice_id: r.paypal_invoice_id,
    invoice_number: r.invoice_number,
    customer_name: r.customer_name,
    customer_email: r.customer_email,
    description: r.description,
    items: (r.items as Invoice["items"]) ?? [],
    note: r.note,
    amount: Number(r.amount),
    currency: "USD",
    issue_date: r.issue_date,
    due_date: r.due_date,
    status: r.status as Invoice["status"],
    paypal_status: r.paypal_status,
    pay_link: r.pay_link,
    paid_at: r.paid_at,
    reminder_count: r.reminder_count,
    created_at: r.created_at,
    sample: r.sample,
  };
}

function toReminder(r: ReminderRow): Reminder {
  return {
    id: r.id,
    invoice_id: r.invoice_id,
    tone: r.tone as Reminder["tone"],
    subject: r.subject,
    body: r.body,
    status: r.status as Reminder["status"],
    created_at: r.created_at,
    sent_at: r.sent_at,
  };
}

/** Called by the single auth listener in the root route. Loads the account's data when the user changes. */
export function setSessionUser(user: { id: string; email?: string | null } | null) {
  if (!user) {
    loadToken++;
    state = { ...EMPTY, authReady: true };
    emit();
    return;
  }
  if (state.userId === user.id && state.authReady) return;
  state = { ...EMPTY, userId: user.id, email: user.email ?? null, authReady: true };
  emit();
  void reload();
}

export async function reload() {
  const userId = state.userId;
  if (!userId) return;
  const token = ++loadToken;
  const [inv, rem, prof] = await Promise.all([
    supabase.from("invoices").select("*").order("created_at", { ascending: false }),
    supabase.from("reminders").select("*").order("created_at", { ascending: false }),
    supabase
      .from("profiles")
      .select("display_name, clock_offset_days")
      .eq("id", userId)
      .maybeSingle(),
  ]);
  if (token !== loadToken) return;
  const err = inv.error ?? rem.error ?? prof.error;
  if (err) {
    toast.error("Couldn't load your invoices", { description: err.message });
  }
  set((s) => ({
    ...s,
    invoices: (inv.data ?? []).map(toInvoice),
    reminders: (rem.data ?? []).map(toReminder),
    clockOffsetDays: prof.data?.clock_offset_days ?? 0,
    displayName: prof.data?.display_name ?? null,
    loaded: true,
  }));
}

function saved(label: string) {
  return ({ error }: { error: { message: string } | null }) => {
    if (error) {
      toast.error(`Couldn't save ${label}`, { description: error.message });
      void reload();
      throw new Error(error.message);
    }
  };
}

function invoiceRow(inv: Invoice) {
  const { sample, ...rest } = inv;
  return { ...rest, sample: Boolean(sample) };
}

function patchRow(patch: Partial<Invoice>) {
  const { id: _id, ...rest } = patch;
  return rest;
}

export const actions = {
  async addInvoice(inv: Invoice) {
    set((s) => ({ ...s, invoices: [inv, ...s.invoices] }));
    await supabase.from("invoices").insert(invoiceRow(inv)).then(saved("the invoice"));
  },
  async updateInvoice(id: string, patch: Partial<Invoice>) {
    set((s) => ({ ...s, invoices: s.invoices.map((i) => (i.id === id ? { ...i, ...patch } : i)) }));
    await supabase.from("invoices").update(patchRow(patch)).eq("id", id).then(saved("the invoice"));
  },
  async removeSamples() {
    set((s) => ({ ...s, invoices: s.invoices.filter((i) => !i.sample) }));
    await supabase.from("invoices").delete().eq("sample", true).then(saved("your changes"));
  },
  async saveReminder(r: Reminder) {
    set((s) => ({ ...s, reminders: [r, ...s.reminders.filter((x) => x.id !== r.id)] }));
    await supabase.from("reminders").upsert(r).then(saved("the reminder"));
  },
  async shiftClock(days: number) {
    const next = Math.max(0, state.clockOffsetDays + days);
    await setClock(next);
  },
  async resetClock() {
    await setClock(0);
  },
  async updateDisplayName(name: string) {
    const userId = state.userId;
    if (!userId) return;
    set((s) => ({ ...s, displayName: name }));
    await supabase
      .from("profiles")
      .update({ display_name: name })
      .eq("id", userId)
      .then(saved("your name"));
  },
};

async function setClock(days: number) {
  const userId = state.userId;
  if (!userId) return;
  set((s) => ({ ...s, clockOffsetDays: days }));
  await supabase
    .from("profiles")
    .update({ clock_offset_days: days })
    .eq("id", userId)
    .then(saved("the demo clock"));
}

/** IDs are UUIDs so a new invoice can show instantly, before the save finishes. */
export function newId(_prefix?: string): string {
  return crypto.randomUUID();
}

/* ---------- One-time move of invoices saved in this browser before accounts existed ---------- */

const LEGACY_KEY = "paynudge:v1";

type LegacyState = { invoices?: Invoice[]; reminders?: Reminder[] };

function readLegacy(): LegacyState | null {
  try {
    const raw = window.localStorage.getItem(LEGACY_KEY);
    return raw ? (JSON.parse(raw) as LegacyState) : null;
  } catch {
    return null;
  }
}

export function legacyInvoiceCount(): number {
  if (typeof window === "undefined") return 0;
  return (readLegacy()?.invoices ?? []).filter((i) => !i.sample).length;
}

export function forgetLegacy() {
  try {
    window.localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* ignore */
  }
}

export async function importLegacy(): Promise<number> {
  const legacy = readLegacy();
  const list = (legacy?.invoices ?? []).filter((i) => !i.sample);
  if (list.length === 0) return 0;
  const known = new Set(state.invoices.map((i) => i.paypal_invoice_id).filter(Boolean));
  const idMap = new Map<string, string>();
  const rows = list
    .filter((i) => !i.paypal_invoice_id || !known.has(i.paypal_invoice_id))
    .map((i) => {
      const id = crypto.randomUUID();
      idMap.set(i.id, id);
      return invoiceRow({
        ...i,
        id,
        pay_link: i.source === "practice" ? `/pay/${id}` : i.pay_link,
        sample: false,
      });
    });
  if (rows.length) {
    const { error } = await supabase.from("invoices").insert(rows);
    if (error) throw new Error(error.message);
  }
  const rems = (legacy?.reminders ?? [])
    .filter((r) => idMap.has(r.invoice_id))
    .map((r) => ({ ...r, id: crypto.randomUUID(), invoice_id: idMap.get(r.invoice_id) as string }));
  if (rems.length) {
    const { error } = await supabase.from("reminders").insert(rems);
    if (error) throw new Error(error.message);
  }
  forgetLegacy();
  await reload();
  return rows.length;
}
