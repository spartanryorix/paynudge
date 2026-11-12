import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { AlertTriangle, Plus, Send, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { actions, newId, useToday } from "@/lib/paynudge/store";
import { usePaypalMode } from "@/lib/paynudge/hooks";
import { addDays, formatUsd, itemsTotal, missingFields, realTodayIso } from "@/lib/paynudge/logic";
import { createAndSendInvoice, parseInvoiceMessage } from "@/lib/paynudge/paynudge.functions";
import type { Invoice } from "@/lib/paynudge/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/new")({
  head: () => ({
    meta: [
      { title: "New invoice — PayNudge" },
      {
        name: "description",
        content:
          "Describe the job in one sentence and PayNudge drafts a PayPal invoice for you to check.",
      },
      { property: "og:title", content: "New invoice — PayNudge" },
      {
        property: "og:description",
        content:
          "Describe the job in one sentence and PayNudge drafts a PayPal invoice for you to check.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: NewInvoice,
});

type ItemRow = { name: string; quantity: string; unit_price: string };
type Form = {
  customer_name: string;
  customer_email: string;
  due_date: string;
  note: string;
  items: ItemRow[];
};

const EXAMPLES = [
  "Logo for Sara, $300, due Friday. sara@email.com",
  "4 math tutoring sessions for Omar at $40 each, pay by end of month, omar.k@mail.com",
  "Hemmed 2 dresses ($35 each) and fixed a zipper $20 for Lina Farouk lina.f@post.com, due in 10 days",
];

const blankForm = (): Form => ({
  customer_name: "",
  customer_email: "",
  due_date: "",
  note: "",
  items: [{ name: "", quantity: "1", unit_price: "" }],
});

function NewInvoice() {
  const navigate = useNavigate();
  const today = useToday();
  const { connected } = usePaypalMode();
  const parse = useServerFn(parseInvoiceMessage);
  const create = useServerFn(createAndSendInvoice);

  const [message, setMessage] = useState("");
  const [form, setForm] = useState<Form>(blankForm);
  const [drafting, setDrafting] = useState(false);
  const [sending, setSending] = useState(false);
  const [showMissing, setShowMissing] = useState(false);
  const [requestId] = useState(() => newId("req"));

  const numericItems = form.items.map((i) => ({
    name: i.name,
    quantity: Number(i.quantity) || 0,
    unit_price: i.unit_price === "" ? null : Number(i.unit_price),
  }));
  const realToday = realTodayIso();
  const missing = useMemo(
    () =>
      missingFields(
        {
          customer_name: form.customer_name,
          customer_email: form.customer_email,
          due_date: form.due_date,
          items: numericItems,
        },
        realToday,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [form, realToday],
  );
  const total = itemsTotal(numericItems.map((i) => ({ ...i, unit_price: i.unit_price ?? 0 })));
  const miss = (k: string) => showMissing && missing.includes(k);

  async function onDraft() {
    if (message.trim().length < 3) {
      toast("Write a sentence first", {
        description: "Who it was for, what you did, how much, and when it's due.",
      });
      return;
    }
    setDrafting(true);
    try {
      const d = await parse({ data: { message, today: realToday } });
      setForm({
        customer_name: d.customer_name ?? "",
        customer_email: d.customer_email ?? "",
        due_date: d.due_date ?? "",
        note: d.note ?? "",
        items: d.items.map((i) => ({
          name: i.name,
          quantity: String(i.quantity),
          unit_price: i.unit_price === null ? "" : String(i.unit_price),
        })),
      });
      setShowMissing(true);
      const n = d.missing.length;
      if (n)
        toast("Draft ready — a few gaps", {
          description: "Fill the highlighted fields before sending.",
        });
      else toast.success("Draft ready. Give it a once-over.");
    } catch (e) {
      toast.error((e as Error).message, { description: "You can still fill the form by hand." });
    } finally {
      setDrafting(false);
    }
  }

  async function onSend() {
    setShowMissing(true);
    if (missing.length) {
      toast.error("A few fields still need you", {
        description: "They're highlighted on the invoice.",
      });
      return;
    }
    const items = numericItems.map((i) => ({
      name: i.name.trim(),
      quantity: i.quantity,
      unit_price: i.unit_price as number,
    }));
    const description = items
      .map((i) => (i.quantity > 1 ? `${i.name} ×${i.quantity}` : i.name))
      .join(", ");
    setSending(true);
    try {
      const id = newId("inv");
      const base = {
        id,
        customer_name: form.customer_name.trim(),
        customer_email: form.customer_email.trim(),
        description,
        items,
        note: form.note.trim(),
        amount: total,
        currency: "USD" as const,
        due_date: form.due_date,
        reminder_count: 0,
        created_at: new Date().toISOString(),
      };
      let inv: Invoice;
      if (connected) {
        const r = await create({
          data: {
            customer_name: base.customer_name,
            customer_email: base.customer_email,
            items,
            due_date: base.due_date,
            note: base.note,
            request_id: requestId,
          },
        });
        inv = {
          ...base,
          source: "paypal",
          paypal_invoice_id: r.paypal_invoice_id,
          invoice_number: r.invoice_number,
          issue_date: r.issue_date,
          status: r.status,
          paypal_status: r.paypal_status,
          pay_link: r.pay_link,
          paid_at: r.paid_at,
        };
        toast.success("Sent through PayPal", {
          description: `${base.customer_name} has a pay link in their inbox.`,
        });
      } else {
        inv = {
          ...base,
          source: "practice",
          paypal_invoice_id: null,
          invoice_number: `PN-${String(Date.now()).slice(-4)}`,
          issue_date: realToday,
          status: "waiting",
          paypal_status: null,
          pay_link: `/pay/${id}`,
          paid_at: null,
        };
        toast.success("Practice invoice created", {
          description: "Connect PayPal to send real sandbox invoices.",
        });
      }
      await actions.addInvoice(inv);
      navigate({ to: "/invoices/$id", params: { id } });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  const setItem = (i: number, patch: Partial<ItemRow>) =>
    setForm((f) => ({ ...f, items: f.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) }));

  return (
    <div className="mx-auto max-w-6xl px-5 pb-20 pt-10 md:pt-14">
      <div className="grid gap-10 lg:grid-cols-[1fr_1.05fr]">
        {/* Left: the message */}
        <section>
          <p className="eyebrow text-muted-foreground">Step 1 · Say it like a text</p>
          <h1 className="text-display mt-3 text-4xl font-medium leading-tight md:text-5xl">
            What did you <span className="italic text-primary">do</span>, and who owes you?
          </h1>
          <div className="mt-8 rounded-xl border border-border bg-card/70 p-1.5 focus-within:border-primary/60 focus-within:glow">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void onDraft();
              }}
              rows={5}
              maxLength={2000}
              placeholder="Designed a logo for Sara, $300, due Friday. sara@email.com"
              className="text-display w-full resize-none rounded-lg bg-transparent px-4 py-3 text-xl leading-snug text-foreground outline-none placeholder:text-muted-foreground/60"
            />
            <div className="flex items-center justify-between gap-3 px-3 pb-2">
              <span className="text-xs text-muted-foreground">⌘/Ctrl + Enter</span>
              <Button variant="mint" onClick={onDraft} disabled={drafting}>
                <Sparkles className={cn(drafting && "animate-spin")} />
                {drafting ? "Reading…" : "Draft with AI"}
              </Button>
            </div>
          </div>
          <div className="mt-5">
            <p className="eyebrow text-muted-foreground">Try one</p>
            <div className="mt-2 flex flex-col gap-2">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => setMessage(ex)}
                  className="rounded-lg border border-dashed border-border px-3 py-2 text-left text-sm text-muted-foreground transition hover:border-primary/50 hover:text-foreground"
                >
                  “{ex}”
                </button>
              ))}
            </div>
          </div>
          <p className="mt-8 max-w-md text-sm text-muted-foreground">
            The AI only fills the form. It never guesses prices or emails — anything it can't find
            is left blank and highlighted for you.
          </p>
        </section>

        {/* Right: the invoice */}
        <section>
          <p className="eyebrow text-muted-foreground">Step 2 · Check it, then send</p>
          <div className="paper mt-3 px-7 py-10 md:px-9">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-display text-4xl font-semibold italic">Invoice</h2>
                <p className="num mt-1 text-xs text-paper-muted">
                  Draft · issued {realToday} · USD
                </p>
              </div>
              <span className="stamp stamp-waiting">Draft</span>
            </div>

            {showMissing && missing.length > 0 && (
              <div className="mt-5 flex items-start gap-2 rounded-md bg-late/15 px-3 py-2 text-sm">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>
                  {missing.length} thing{missing.length > 1 ? "s" : ""} to fill in before sending.
                </span>
              </div>
            )}

            <div className="perforation mt-6" />

            <fieldset className="mt-6 grid gap-5 sm:grid-cols-2">
              <legend className="eyebrow mb-3 text-paper-muted">Bill to</legend>
              <label className="block">
                <span className="text-xs text-paper-muted">Name</span>
                <input
                  className="paper-field text-lg font-semibold"
                  data-missing={miss("customer_name")}
                  value={form.customer_name}
                  onChange={(e) => setForm({ ...form, customer_name: e.target.value })}
                  placeholder="Sara Haddad"
                  maxLength={120}
                />
              </label>
              <label className="block">
                <span className="text-xs text-paper-muted">Email</span>
                <input
                  type="email"
                  className="paper-field num"
                  data-missing={miss("customer_email")}
                  value={form.customer_email}
                  onChange={(e) => setForm({ ...form, customer_email: e.target.value })}
                  placeholder="sara@email.com"
                  maxLength={200}
                />
              </label>
            </fieldset>

            <div className="mt-8">
              <div className="eyebrow grid grid-cols-[1fr_3.5rem_5.5rem_1.5rem] gap-3 text-paper-muted">
                <span>Item</span>
                <span className="text-right">Qty</span>
                <span className="text-right">Price</span>
                <span />
              </div>
              {form.items.map((it, i) => (
                <div
                  key={i}
                  className="mt-2 grid grid-cols-[1fr_3.5rem_5.5rem_1.5rem] items-end gap-3"
                >
                  <input
                    className="paper-field"
                    data-missing={miss(`items.${i}.name`)}
                    value={it.name}
                    onChange={(e) => setItem(i, { name: e.target.value })}
                    placeholder="Logo design"
                    maxLength={200}
                  />
                  <input
                    inputMode="decimal"
                    className="paper-field num text-right"
                    data-missing={miss(`items.${i}.quantity`)}
                    value={it.quantity}
                    onChange={(e) =>
                      setItem(i, { quantity: e.target.value.replace(/[^\d.]/g, "") })
                    }
                  />
                  <input
                    inputMode="decimal"
                    className="paper-field num text-right"
                    data-missing={miss(`items.${i}.unit_price`)}
                    value={it.unit_price}
                    onChange={(e) =>
                      setItem(i, { unit_price: e.target.value.replace(/[^\d.]/g, "") })
                    }
                    placeholder="0.00"
                  />
                  <button
                    type="button"
                    aria-label="Remove item"
                    disabled={form.items.length === 1}
                    onClick={() =>
                      setForm((f) => ({ ...f, items: f.items.filter((_, j) => j !== i) }))
                    }
                    className="pb-2 text-paper-muted hover:text-paper-foreground disabled:opacity-30"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  setForm((f) => ({
                    ...f,
                    items: [...f.items, { name: "", quantity: "1", unit_price: "" }],
                  }))
                }
                className="mt-3 inline-flex items-center gap-1 text-sm text-ink hover:underline"
              >
                <Plus className="size-3.5" /> Add a line
              </button>
            </div>

            <div className="mt-8 grid gap-5 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs text-paper-muted">Due date</span>
                <input
                  type="date"
                  min={realToday}
                  className="paper-field num"
                  data-missing={miss("due_date")}
                  value={form.due_date}
                  onChange={(e) => setForm({ ...form, due_date: e.target.value })}
                />
                <span className="mt-1 flex gap-2">
                  {[7, 14, 30].map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setForm({ ...form, due_date: addDays(realToday, d) })}
                      className="num rounded border border-paper-line px-1.5 py-0.5 text-[11px] text-paper-muted hover:border-paper-foreground hover:text-paper-foreground"
                    >
                      +{d}d
                    </button>
                  ))}
                </span>
              </label>
              <label className="block">
                <span className="text-xs text-paper-muted">Note to customer (optional)</span>
                <input
                  className="paper-field"
                  value={form.note}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
                  placeholder="Thanks for the work!"
                  maxLength={1000}
                />
              </label>
            </div>

            <div className="perforation mt-8" />
            <div className="mt-5 flex items-baseline justify-between">
              <span className="eyebrow text-paper-muted">Total due</span>
              <span className="num text-3xl font-bold">{formatUsd(total)}</span>
            </div>

            <Button
              variant="paper"
              size="xl"
              className="mt-7 w-full"
              onClick={onSend}
              disabled={sending}
            >
              <Send />{" "}
              {sending
                ? "Sending…"
                : connected
                  ? "Send invoice through PayPal"
                  : "Create practice invoice"}
            </Button>
            <p className="mt-3 text-center text-xs text-paper-muted">
              {connected
                ? "PayPal emails your customer a pay link. Sandbox only — no real money moves."
                : "PayPal isn't connected, so this stays a practice invoice on this device."}
            </p>
            {today !== realToday && (
              <p className="mt-2 text-center text-xs text-paper-muted">
                Demo clock is on — invoices are still dated today.
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
