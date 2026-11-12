import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  CircleDollarSign,
  ExternalLink,
  MailCheck,
  RefreshCw,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { StatusStamp } from "@/components/paynudge/StatusStamp";
import { actions, newId, useStore, useToday } from "@/lib/paynudge/store";
import { syncNow, useAutoSync } from "@/lib/paynudge/hooks";
import {
  daysBetween,
  daysLate,
  displayStatus,
  formatDate,
  formatUsd,
  toneFor,
  TONE_LABEL,
} from "@/lib/paynudge/logic";
import {
  draftReminder,
  recordSandboxPayment,
  sendPaypalReminder,
  syncInvoices,
} from "@/lib/paynudge/paynudge.functions";
import type { Reminder, ReminderTone } from "@/lib/paynudge/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/invoices/$id")({
  validateSearch: (s: Record<string, unknown>): { remind?: boolean } =>
    s["remind"] === true || s["remind"] === "true" ? { remind: true } : {},
  head: () => ({
    meta: [
      { title: "Invoice — PayNudge" },
      {
        name: "description",
        content: "Check an invoice's PayPal status and send a polite reminder you approve.",
      },
      { property: "og:title", content: "Invoice — PayNudge" },
      {
        property: "og:description",
        content: "Check an invoice's PayPal status and send a polite reminder you approve.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: InvoicePage,
});

const TONE_SCALE: ReminderTone[] = ["heads-up", "friendly", "polite-clear", "firm"];

function InvoicePage() {
  useAutoSync();
  const { id } = Route.useParams();
  const { remind } = Route.useSearch();
  const { invoices, reminders, hydrated } = useStore();
  const today = useToday();
  const inv = invoices.find((i) => i.id === id);

  const sync = useServerFn(syncInvoices);
  const recordPay = useServerFn(recordSandboxPayment);
  const draft = useServerFn(draftReminder);
  const sendRemind = useServerFn(sendPaypalReminder);

  const [busy, setBusy] = useState<null | "sync" | "pay" | "draft" | "send">(null);
  const [current, setCurrent] = useState<Reminder | null>(null);
  const autoDrafted = useRef(false);
  const reminderRef = useRef<HTMLDivElement>(null);

  const status = inv ? displayStatus(inv, today) : "waiting";
  const late = inv ? daysLate(inv.due_date, today) : 0;
  const tone = toneFor(late);
  const history = reminders.filter((r) => r.invoice_id === id && r.status === "sent");

  useEffect(() => {
    if (!remind || !inv || autoDrafted.current || status === "paid" || status === "cancelled")
      return;
    autoDrafted.current = true;
    reminderRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    void onDraft();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remind, inv?.id, status]);

  if (!hydrated)
    return (
      <div className="mx-auto max-w-6xl px-5 py-20 text-muted-foreground">Opening invoice…</div>
    );
  if (!inv) {
    return (
      <div className="mx-auto max-w-xl px-5 py-24 text-center">
        <h1 className="text-display text-4xl">Invoice not found</h1>
        <p className="mt-3 text-muted-foreground">It isn't in your account, or it was deleted.</p>
        <Button asChild variant="mint" className="mt-6">
          <Link to="/">Back to the ledger</Link>
        </Button>
      </div>
    );
  }
  const invoice = inv;

  async function onSync() {
    if (!invoice.paypal_invoice_id) return;
    setBusy("sync");
    try {
      const n = await syncNow(sync, [invoice.paypal_invoice_id]);
      toast.success(n ? "Updated from PayPal" : "PayPal says nothing's changed");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function onRecordPayment() {
    setBusy("pay");
    try {
      if (invoice.source === "paypal" && invoice.paypal_invoice_id) {
        const f = await recordPay({
          data: {
            id: invoice.paypal_invoice_id,
            amount: invoice.amount,
            request_id: `${invoice.id}-pay`,
          },
        });
        actions.updateInvoice(invoice.id, {
          status: f.status,
          paypal_status: f.paypal_status,
          paid_at: f.paid_at ?? new Date().toISOString(),
        });
      } else {
        actions.updateInvoice(invoice.id, { status: "paid", paid_at: new Date().toISOString() });
      }
      toast.success("Marked as paid");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function onDraft() {
    setBusy("draft");
    try {
      const r = await draft({
        data: {
          customer_name: invoice.customer_name,
          description: invoice.description,
          amount: invoice.amount,
          due_date: invoice.due_date,
          days_late: late,
          reminder_count: invoice.reminder_count,
        },
      });
      setCurrent({
        id: newId("rem"),
        invoice_id: invoice.id,
        tone: r.tone,
        subject: r.subject,
        body: r.body,
        status: "draft",
        created_at: new Date().toISOString(),
        sent_at: null,
      });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function onApprove() {
    if (!current) return;
    if (!current.subject.trim() || !current.body.trim()) {
      toast.error("Subject and message can't be empty");
      return;
    }
    setBusy("send");
    try {
      if (invoice.source === "paypal" && invoice.paypal_invoice_id) {
        await sendRemind({
          data: { id: invoice.paypal_invoice_id, subject: current.subject, body: current.body },
        });
      }
      actions.saveReminder({ ...current, status: "sent", sent_at: new Date().toISOString() });
      actions.updateInvoice(invoice.id, { reminder_count: invoice.reminder_count + 1 });
      setCurrent(null);
      toast.success(
        invoice.source === "paypal" ? "Reminder sent through PayPal" : "Practice reminder saved",
        {
          description: `To ${invoice.customer_name}`,
        },
      );
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const payHref = invoice.pay_link;
  const isOpen = status === "waiting" || status === "late";

  return (
    <div className="mx-auto max-w-6xl px-5 pb-20 pt-8">
      <Link
        to="/"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Ledger
      </Link>

      <div className="mt-6 grid gap-10 lg:grid-cols-[1.1fr_1fr]">
        {/* Invoice sheet */}
        <article className="paper relative self-start px-7 py-10 md:px-10">
          <div className="absolute right-8 top-10">
            <StatusStamp key={status} status={status} days={late} size="xl" />
          </div>
          <p className="eyebrow text-paper-muted">
            {invoice.source === "paypal" ? "PayPal sandbox invoice" : "Practice invoice"}
          </p>
          <h1 className="text-display mt-2 text-4xl font-semibold italic">Invoice</h1>
          <p className="num mt-1 text-sm text-paper-muted">{invoice.invoice_number}</p>

          <div className="mt-8 grid grid-cols-2 gap-6 text-sm">
            <div>
              <p className="eyebrow text-paper-muted">Bill to</p>
              <p className="mt-1 text-lg font-semibold">{invoice.customer_name}</p>
              <p className="num text-paper-muted">{invoice.customer_email}</p>
            </div>
            <div className="text-right">
              <p className="eyebrow text-paper-muted">Issued</p>
              <p className="num mt-1">{formatDate(invoice.issue_date)}</p>
              <p className="eyebrow mt-3 text-paper-muted">Due</p>
              <p className="num mt-1 font-semibold">{formatDate(invoice.due_date)}</p>
            </div>
          </div>

          <div className="perforation mt-8" />
          <ul className="mt-4 space-y-3">
            {invoice.items.map((it, i) => (
              <li key={i} className="flex items-baseline gap-3">
                <span className="flex-1">
                  {it.name}
                  {it.quantity !== 1 && (
                    <span className="num ml-2 text-xs text-paper-muted">×{it.quantity}</span>
                  )}
                </span>
                <span className="num">{formatUsd(it.quantity * it.unit_price)}</span>
              </li>
            ))}
          </ul>
          <div className="perforation mt-5" />
          <div className="mt-4 flex items-baseline justify-between">
            <span className="eyebrow text-paper-muted">Total · USD</span>
            <span className="num text-3xl font-bold">{formatUsd(invoice.amount)}</span>
          </div>
          {invoice.note && (
            <p className="text-display mt-6 italic text-paper-muted">“{invoice.note}”</p>
          )}
          {invoice.paypal_status && (
            <p className="num mt-6 text-xs text-paper-muted">
              PayPal status: {invoice.paypal_status}
            </p>
          )}
        </article>

        {/* Actions */}
        <div className="space-y-6">
          <div className="rounded-xl border border-border bg-card/70 p-6">
            <p className="eyebrow text-muted-foreground">Status</p>
            <p className="text-display mt-2 text-3xl">
              {status === "paid" && <span className="text-primary">Paid. Nothing to chase.</span>}
              {status === "waiting" && (
                <>
                  Waiting · due{" "}
                  {daysBetween(today, invoice.due_date) === 0
                    ? "today"
                    : `in ${daysBetween(today, invoice.due_date)} days`}
                </>
              )}
              {status === "late" && (
                <>
                  <span className="text-late">{late} days late</span>
                </>
              )}
              {status === "cancelled" && "Cancelled"}
            </p>
            {invoice.paid_at && status === "paid" && (
              <p className="num mt-1 text-sm text-muted-foreground">
                on {formatDate(invoice.paid_at.slice(0, 10))}
              </p>
            )}

            <div className="mt-5 flex flex-wrap gap-2">
              {payHref &&
                (invoice.source === "paypal" ? (
                  <Button asChild variant="desk">
                    <a href={payHref} target="_blank" rel="noreferrer">
                      <ExternalLink /> Open PayPal pay page
                    </a>
                  </Button>
                ) : (
                  <Button asChild variant="desk">
                    <Link to="/pay/$id" params={{ id: invoice.id }} target="_blank">
                      <ExternalLink /> Customer's pay page
                    </Link>
                  </Button>
                ))}
              {invoice.source === "paypal" && (
                <Button variant="desk" onClick={onSync} disabled={busy !== null}>
                  <RefreshCw className={cn(busy === "sync" && "animate-spin")} /> Check PayPal
                </Button>
              )}
              {isOpen && (
                <Button variant="desk" onClick={onRecordPayment} disabled={busy !== null}>
                  <CircleDollarSign />{" "}
                  {invoice.source === "paypal" ? "Record sandbox payment" : "Mark as paid"}
                </Button>
              )}
            </div>
            {invoice.source === "paypal" && isOpen && (
              <p className="mt-3 text-xs text-muted-foreground">
                Checking PayPal every 10 seconds. Pay with your sandbox buyer account and this flips
                to Paid by itself.
              </p>
            )}
          </div>

          {isOpen && (
            <div
              ref={reminderRef}
              className="scroll-mt-6 rounded-xl border border-border bg-card/70 p-6"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="eyebrow text-primary">Nudge</p>
                  <h2 className="text-display mt-1 text-2xl">Draft a reminder</h2>
                </div>
                <span className="text-xs text-muted-foreground">
                  {invoice.reminder_count} sent so far
                </span>
              </div>

              <div className="mt-4">
                <p className="text-xs text-muted-foreground">Tone, picked from days late</p>
                <div className="mt-2 grid grid-cols-4 gap-1">
                  {TONE_SCALE.map((t) => (
                    <div
                      key={t}
                      className={cn(
                        "rounded-md border px-2 py-1.5 text-center text-[11px] leading-tight",
                        t === tone
                          ? "border-primary bg-primary/15 text-primary"
                          : "border-border text-muted-foreground",
                      )}
                    >
                      {TONE_LABEL[t]}
                    </div>
                  ))}
                </div>
              </div>

              {!current ? (
                <Button
                  variant="mint"
                  className="mt-5 w-full"
                  size="lg"
                  onClick={onDraft}
                  disabled={busy !== null}
                >
                  <Sparkles className={cn(busy === "draft" && "animate-spin")} />
                  {busy === "draft" ? "Writing a polite one…" : "Draft reminder with AI"}
                </Button>
              ) : (
                <div className="sheet mt-5 rounded-lg p-5">
                  <p className="eyebrow text-paper-muted">To {invoice.customer_email}</p>
                  <input
                    value={current.subject}
                    onChange={(e) => setCurrent({ ...current, subject: e.target.value })}
                    className="paper-field mt-2 font-semibold"
                    maxLength={200}
                    aria-label="Subject"
                  />
                  <textarea
                    value={current.body}
                    onChange={(e) => setCurrent({ ...current, body: e.target.value })}
                    rows={7}
                    maxLength={4000}
                    aria-label="Message"
                    className="paper-field mt-3 resize-y leading-relaxed"
                  />
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button variant="paper" onClick={onApprove} disabled={busy !== null}>
                      <Check /> {busy === "send" ? "Sending…" : "Approve & send"}
                    </Button>
                    <Button variant="paper-outline" onClick={onDraft} disabled={busy !== null}>
                      <Sparkles /> Redraft
                    </Button>
                    <Button
                      variant="paper-outline"
                      onClick={() => setCurrent(null)}
                      disabled={busy !== null}
                      aria-label="Discard draft"
                    >
                      <Trash2 />
                    </Button>
                  </div>
                  <p className="mt-3 text-xs text-paper-muted">
                    Nothing goes out until you approve it.
                  </p>
                </div>
              )}
            </div>
          )}

          {history.length > 0 && (
            <div className="rounded-xl border border-border p-6">
              <p className="eyebrow text-muted-foreground">Sent reminders</p>
              <ul className="mt-3 space-y-4">
                {history.map((r) => (
                  <li key={r.id} className="border-l-2 border-primary/50 pl-4">
                    <p className="flex items-center gap-2 text-sm font-semibold">
                      <MailCheck className="size-4 text-primary" /> {r.subject}
                    </p>
                    <p className="num mt-0.5 text-xs text-muted-foreground">
                      {TONE_LABEL[r.tone]} · {r.sent_at ? formatDate(r.sent_at.slice(0, 10)) : ""}
                    </p>
                    <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">
                      {r.body}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
