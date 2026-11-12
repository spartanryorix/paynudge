import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { aiJson } from "@/server/ai.server";
import { fetchInvoice, paypal, paypalConfigured, type PaypalInvoice } from "@/server/paypal.server";
import { isEmail, itemsTotal, round2, toneFor, TONE_LABEL } from "@/lib/paynudge/logic";
import type { InvoiceDraft } from "@/lib/paynudge/types";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const getPaypalMode = createServerFn({ method: "GET" }).handler(async () => {
  return { connected: paypalConfigured() };
});

/* ---------------- AI job 1: message → invoice draft ---------------- */

const draftSchema = {
  type: "object",
  additionalProperties: false,
  required: ["customer_name", "customer_email", "items", "due_date", "note", "missing"],
  properties: {
    customer_name: { type: ["string", "null"] },
    customer_email: { type: ["string", "null"] },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "quantity", "unit_price"],
        properties: {
          name: { type: "string" },
          quantity: { type: "number" },
          unit_price: { type: ["number", "null"] },
        },
      },
    },
    due_date: { type: ["string", "null"], description: "YYYY-MM-DD" },
    note: { type: ["string", "null"] },
    missing: { type: "array", items: { type: "string" } },
  },
};

export const parseInvoiceMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ message: z.string().trim().min(3).max(2000), today: isoDate }).parse(d),
  )
  .handler(async ({ data }): Promise<InvoiceDraft> => {
    const weekday = new Date(`${data.today}T00:00:00Z`).toLocaleDateString("en-US", {
      weekday: "long",
      timeZone: "UTC",
    });
    const raw = await aiJson<InvoiceDraft>({
      name: "invoice_draft",
      schema: draftSchema,
      instructions:
        `Turn a short message from a freelancer into invoice data. Today is ${weekday} ${data.today}. ` +
        "Resolve relative dates like 'Friday' or 'in 2 weeks' to YYYY-MM-DD in the future. " +
        "Currency is always USD. Never invent amounts, names or emails. If something is missing, use null and list the field name in missing " +
        "(use customer_name, customer_email, due_date, or items.N.unit_price). Default quantity to 1. Keep item names short and professional. " +
        "note is an optional short thank-you or detail mentioned by the seller, else null.",
      input: data.message,
    });

    // Code double-checks the AI: never trust invented emails or amounts.
    const msg = data.message.toLowerCase().replace(/,/g, "");
    const missing = new Set(raw.missing ?? []);
    let email = raw.customer_email?.trim() || null;
    if (email && (!isEmail(email) || !msg.includes(email.toLowerCase()))) email = null;
    if (!email) missing.add("customer_email");
    if (!raw.customer_name) missing.add("customer_name");
    let due = raw.due_date && /^\d{4}-\d{2}-\d{2}$/.test(raw.due_date) ? raw.due_date : null;
    if (due && due < data.today) due = null;
    if (!due) missing.add("due_date");
    const items = (raw.items ?? []).slice(0, 20).map((it, i) => {
      let price =
        typeof it.unit_price === "number" && it.unit_price > 0 ? round2(it.unit_price) : null;
      if (price !== null) {
        const asText = String(price);
        const total = String(round2(price * (it.quantity || 1)));
        if (!msg.includes(asText) && !msg.includes(total)) price = null;
      }
      if (price === null) missing.add(`items.${i}.unit_price`);
      return {
        name: it.name || "Service",
        quantity: it.quantity > 0 ? it.quantity : 1,
        unit_price: price,
      };
    });
    if (items.length === 0) {
      items.push({ name: "", quantity: 1, unit_price: null });
      missing.add("items.0.unit_price");
    }
    return {
      customer_name: raw.customer_name?.trim() || null,
      customer_email: email,
      items,
      due_date: due,
      note: raw.note?.trim() || null,
      missing: [...missing],
    };
  });

/* ---------------- PayPal: create + send ---------------- */

const createSchema = z.object({
  customer_name: z.string().trim().min(1).max(120),
  customer_email: z.string().trim().email().max(200),
  items: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(200),
        quantity: z.number().positive().max(10000),
        unit_price: z.number().positive().max(1_000_000),
      }),
    )
    .min(1)
    .max(20),
  due_date: isoDate,
  note: z.string().max(1000).default(""),
  request_id: z.string().min(8).max(100),
});

export const createAndSendInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => createSchema.parse(d))
  .handler(async ({ data }) => {
    const today = new Date().toISOString().slice(0, 10);
    if (data.due_date < today) throw new Error("The due date is in the past.");
    const [given, ...rest] = data.customer_name.split(/\s+/);
    const { invoice_number } = await paypal<{ invoice_number: string }>(
      "/v2/invoicing/generate-next-invoice-number",
      {
        method: "POST",
      },
    );
    const draft = await paypal<{ href?: string; id?: string }>("/v2/invoicing/invoices", {
      method: "POST",
      requestId: `${data.request_id}-create`,
      body: {
        detail: {
          invoice_number,
          currency_code: "USD",
          invoice_date: today,
          payment_term: { term_type: "DUE_ON_DATE_SPECIFIED", due_date: data.due_date },
          ...(data.note ? { note: data.note } : {}),
        },
        primary_recipients: [
          {
            billing_info: {
              name: {
                given_name: given ?? data.customer_name,
                ...(rest.length ? { surname: rest.join(" ") } : {}),
              },
              email_address: data.customer_email,
            },
          },
        ],
        items: data.items.map((i) => ({
          name: i.name,
          quantity: String(i.quantity),
          unit_amount: { currency_code: "USD", value: i.unit_price.toFixed(2) },
        })),
      },
    });
    const id = draft.id ?? draft.href?.split("/").pop();
    if (!id) throw new Error("PayPal created the invoice but didn't return its ID.");
    await paypal(`/v2/invoicing/invoices/${id}/send`, {
      method: "POST",
      requestId: `${data.request_id}-send`,
      body: { send_to_recipient: true, send_to_invoicer: false },
    });
    const synced = await fetchInvoice(id);
    return { ...synced, invoice_number, amount: itemsTotal(data.items), issue_date: today };
  });

/* ---------------- PayPal: sync, demo payment, reminder ---------------- */

/** Only PayPal invoices that belong to the signed-in account. */
async function ownedPaypalIds(
  supabase: SupabaseClient<Database>,
  ids: string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { data, error } = await supabase
    .from("invoices")
    .select("paypal_invoice_id")
    .in("paypal_invoice_id", ids);
  if (error) throw new Error("Couldn't check your invoices.");
  return new Set((data ?? []).flatMap((r) => (r.paypal_invoice_id ? [r.paypal_invoice_id] : [])));
}

async function assertOwned(supabase: SupabaseClient<Database>, id: string) {
  const owned = await ownedPaypalIds(supabase, [id]);
  if (!owned.has(id)) throw new Error("That invoice isn't in your account.");
}

export const syncInvoices = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ ids: z.array(z.string().min(3).max(60)).max(50) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const owned = await ownedPaypalIds(context.supabase, data.ids);
    const results = await Promise.allSettled([...owned].map((id) => fetchInvoice(id)));
    return results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  });

export const recordSandboxPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().min(3).max(60),
        // Still accepted so older clients keep working, but ignored: the amount recorded
        // always comes from the invoice on PayPal's side, never from the browser.
        amount: z.number().optional(),
        request_id: z.string().min(8).max(100),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertOwned(context.supabase, data.id);
    const inv = await paypal<PaypalInvoice>(
      `/v2/invoicing/invoices/${encodeURIComponent(data.id)}`,
    );
    const due = Number(inv.due_amount?.value ?? inv.amount?.value);
    if (!Number.isFinite(due) || due <= 0) throw new Error("Nothing is due on this invoice.");
    await paypal(`/v2/invoicing/invoices/${encodeURIComponent(data.id)}/payments`, {
      method: "POST",
      requestId: data.request_id,
      body: {
        method: "OTHER",
        payment_date: new Date().toISOString().slice(0, 10),
        amount: { currency_code: "USD", value: due.toFixed(2) },
        note: "Recorded from PayNudge sandbox demo",
      },
    });
    return fetchInvoice(data.id);
  });

export const sendPaypalReminder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().min(3).max(60),
        subject: z.string().trim().min(1).max(200),
        body: z.string().trim().min(1).max(4000),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertOwned(context.supabase, data.id);
    await paypal(`/v2/invoicing/invoices/${encodeURIComponent(data.id)}/remind`, {
      method: "POST",
      body: {
        subject: data.subject,
        note: data.body,
        send_to_invoicer: false,
        send_to_recipient: true,
      },
    });
    return { ok: true };
  });

/* ---------------- AI job 2: reminder draft ---------------- */

export const draftReminder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        customer_name: z.string().min(1).max(120),
        description: z.string().max(300),
        amount: z.number().positive(),
        due_date: isoDate,
        days_late: z.number().int().min(0).max(3650),
        reminder_count: z.number().int().min(0).max(100),
        seller_name: z.string().max(80).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const tone = toneFor(data.days_late);
    const out = await aiJson<{ subject: string; message: string }>({
      name: "reminder",
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["subject", "message"],
        properties: { subject: { type: "string" }, message: { type: "string" } },
      },
      instructions:
        `Write a short payment reminder from a freelancer to a customer. Tone: ${TONE_LABEL[tone]}. ` +
        "Rules: under 90 words, warm and human, no threats, no late fees, no legal claims, no invented facts. " +
        "Mention the amount and what it was for. Say the PayPal pay link is in this email. Sign off simply without a name placeholder. " +
        "Do not use square-bracket placeholders.",
      input: JSON.stringify({
        customer_first_name: data.customer_name.split(/\s+/)[0],
        work: data.description,
        amount: `$${data.amount.toFixed(2)} USD`,
        due_date: data.due_date,
        days_late: data.days_late,
        reminders_already_sent: data.reminder_count,
      }),
    });
    return { tone, subject: out.subject.trim(), body: out.message.trim() };
  });

/* ---------------- AI job 3: weekly summary ---------------- */

export const writeWeeklySummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        owed: z.number().min(0),
        waitingCount: z.number().int().min(0),
        paidThisWeek: z.number().min(0),
        expectedThisWeek: z.number().min(0),
        late: z
          .array(
            z.object({ name: z.string().max(120), amount: z.number(), days: z.number().int() }),
          )
          .max(50),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const out = await aiJson<{ sentences: string[] }>({
      name: "weekly_summary",
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["sentences"],
        properties: { sentences: { type: "array", items: { type: "string" } } },
      },
      instructions:
        "You write a freelancer's weekly money check-in. Turn the given numbers into exactly 3 short, plain sentences, " +
        "second person ('You're owed...'). Use only the numbers given, formatted as US dollars. Never compute new totals. " +
        "Sentence 1: total owed. Sentence 2: who is late (most days first) or that nobody is late. Sentence 3: what to expect this week.",
      input: JSON.stringify(data),
    });
    return { sentences: out.sentences.slice(0, 3) };
  });
