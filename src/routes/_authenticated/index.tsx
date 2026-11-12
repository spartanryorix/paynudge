import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Feather, Plus, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { StatusStamp } from "@/components/paynudge/StatusStamp";
import {
  actions,
  forgetLegacy,
  importLegacy,
  legacyInvoiceCount,
  useStore,
  useToday,
} from "@/lib/paynudge/store";
import { syncNow, useAutoSync } from "@/lib/paynudge/hooks";
import {
  daysLate,
  displayStatus,
  formatDate,
  formatUsd,
  weeklyNumbers,
} from "@/lib/paynudge/logic";
import { syncInvoices, writeWeeklySummary } from "@/lib/paynudge/paynudge.functions";
import type { DisplayStatus } from "@/lib/paynudge/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "Ledger — PayNudge" },
      {
        name: "description",
        content: "See who paid, who's waiting and who's late, and nudge them with one tap.",
      },
      { property: "og:title", content: "Ledger — PayNudge" },
      {
        property: "og:description",
        content: "See who paid, who's waiting and who's late, and nudge them with one tap.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});

type Filter = "all" | DisplayStatus;

function Dashboard() {
  useAutoSync();
  const { invoices, hydrated } = useStore();
  const today = useToday();
  const [filter, setFilter] = useState<Filter>("all");
  const [syncing, setSyncing] = useState(false);
  const [summary, setSummary] = useState<string[] | null>(null);
  const [summaryBusy, setSummaryBusy] = useState(false);
  const sync = useServerFn(syncInvoices);
  const summarize = useServerFn(writeWeeklySummary);

  const nums = useMemo(() => weeklyNumbers(invoices, today), [invoices, today]);
  const rows = useMemo(
    () =>
      invoices
        .map((inv) => ({
          inv,
          status: displayStatus(inv, today),
          late: daysLate(inv.due_date, today),
        }))
        .filter((r) => filter === "all" || r.status === filter)
        .sort(
          (a, b) =>
            rank(a.status) - rank(b.status) ||
            b.late - a.late ||
            a.inv.due_date.localeCompare(b.inv.due_date),
        ),
    [invoices, today, filter],
  );
  const counts = useMemo(() => {
    const c = { all: invoices.length, waiting: 0, late: 0, paid: 0, cancelled: 0 };
    invoices.forEach((i) => c[displayStatus(i, today)]++);
    return c;
  }, [invoices, today]);
  const hasSamples = invoices.some((i) => i.sample);
  const [legacyCount, setLegacyCount] = useState(0);
  const [importing, setImporting] = useState(false);
  useEffect(() => setLegacyCount(legacyInvoiceCount()), []);

  async function onImport() {
    setImporting(true);
    try {
      const n = await importLegacy();
      setLegacyCount(0);
      toast.success(
        n
          ? `Moved ${n} invoice${n > 1 ? "s" : ""} into your account`
          : "Those invoices were already here",
      );
    } catch (e) {
      toast.error("Couldn't move them", { description: (e as Error).message });
    } finally {
      setImporting(false);
    }
  }

  async function onSync() {
    const ids = invoices
      .filter((i) => i.source === "paypal" && i.paypal_invoice_id)
      .map((i) => i.paypal_invoice_id as string);
    if (ids.length === 0) {
      toast("Nothing to check yet", {
        description: "Invoices sent through PayPal will update here.",
      });
      return;
    }
    setSyncing(true);
    try {
      const n = await syncNow(sync, ids);
      toast.success(
        n ? `${n} invoice${n > 1 ? "s" : ""} updated from PayPal` : "Everything's up to date",
      );
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSyncing(false);
    }
  }

  async function onSummary() {
    setSummaryBusy(true);
    try {
      const res = await summarize({ data: nums });
      setSummary(res.sentences);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSummaryBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-5 pb-20 pt-10 md:pt-16">
      {/* Headline + tally receipt */}
      <section className="grid items-start gap-10 md:grid-cols-12">
        <div className="md:col-span-7">
          <p className="eyebrow text-muted-foreground">
            The ledger · {hydrated ? formatDate(today) : "today"}
          </p>
          <h1 className="text-display mt-4 text-5xl font-medium leading-[0.95] md:text-7xl">
            You're owed
            <span className="mt-2 block font-semibold italic text-primary">
              {hydrated ? formatUsd(nums.owed) : "—"}
            </span>
          </h1>
          <p className="mt-6 max-w-md text-lg text-muted-foreground">
            {nums.waitingCount === 0
              ? "Nobody owes you right now. Nice."
              : `${nums.waitingCount} invoice${nums.waitingCount > 1 ? "s" : ""} out, ${nums.late.length} late. Type what you did and PayNudge does the paperwork.`}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild variant="mint" size="xl">
              <Link to="/new">
                <Plus /> New invoice
              </Link>
            </Button>
            <Button variant="desk" size="xl" onClick={onSync} disabled={syncing}>
              <RefreshCw className={cn(syncing && "animate-spin")} /> Check PayPal now
            </Button>
          </div>
        </div>

        <aside className="paper animate-print px-7 py-9 md:col-span-5 md:mt-6 md:rotate-[1.2deg]">
          <div className="flex items-baseline justify-between">
            <span className="eyebrow text-paper-muted">Tally</span>
            <span className="num text-xs text-paper-muted">
              #{String(invoices.length).padStart(4, "0")}
            </span>
          </div>
          <div className="perforation mt-4" />
          <dl className="mt-4 space-y-3">
            <TallyRow label="Owed to you" value={formatUsd(nums.owed)} strong />
            <TallyRow
              label="Late"
              value={`${nums.late.length} · ${formatUsd(nums.late.reduce((s, l) => s + l.amount, 0))}`}
              late={nums.late.length > 0}
            />
            <TallyRow label="Paid, last 7 days" value={formatUsd(nums.paidThisWeek)} />
            <TallyRow label="Expected this week" value={formatUsd(nums.expectedThisWeek)} />
          </dl>
          <div className="perforation mt-5" />
          <p className="mt-4 text-center text-display text-sm italic text-paper-muted">
            thank you for not chasing
          </p>
        </aside>
      </section>

      {/* Weekly memo */}
      <section className="mt-16 rounded-xl border border-border bg-card/60 p-6 md:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="eyebrow text-primary">Weekly memo</p>
            <h2 className="text-display mt-1 text-2xl">Where your money stands</h2>
          </div>
          <Button variant="desk" onClick={onSummary} disabled={summaryBusy || !hydrated}>
            <Sparkles className={cn(summaryBusy && "animate-pulse")} />
            {summaryBusy ? "Writing…" : summary ? "Rewrite" : "Write this week's summary"}
          </Button>
        </div>
        {summary ? (
          <div className="mt-5 space-y-2 border-l-2 border-primary pl-5">
            {summary.map((s, i) => (
              <p key={i} className="text-display text-lg italic leading-snug md:text-xl">
                {s}
              </p>
            ))}
          </div>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">
            The numbers are added up by PayNudge. The AI only turns them into three plain sentences.
          </p>
        )}
      </section>

      {/* Ledger */}
      <section className="mt-14">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2 className="text-display text-3xl">Invoices</h2>
          <div className="flex flex-wrap gap-1 rounded-full border border-border bg-secondary/40 p-1">
            {(["all", "late", "waiting", "paid"] as Filter[]).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={cn(
                  "eyebrow rounded-full px-3 py-1.5 transition",
                  filter === f
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {f} <span className="num opacity-70">{counts[f as keyof typeof counts]}</span>
              </button>
            ))}
          </div>
        </div>

        {legacyCount > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-primary/40 bg-primary/10 px-4 py-3 text-sm">
            <span>
              We found <span className="num font-semibold">{legacyCount}</span> invoice
              {legacyCount > 1 ? "s" : ""} saved in this browser from before accounts.
            </span>
            <Button size="sm" variant="mint" disabled={importing} onClick={onImport}>
              {importing ? "Moving…" : "Move them into my account"}
            </Button>
            <button
              type="button"
              className="text-muted-foreground underline underline-offset-4"
              onClick={() => {
                forgetLegacy();
                setLegacyCount(0);
              }}
            >
              Ignore
            </button>
          </div>
        )}

        {hasSamples && (
          <p className="mt-4 text-sm text-muted-foreground">
            The invoices marked <span className="eyebrow text-primary">sample</span> are practice
            data so you can try things.{" "}
            <button
              type="button"
              onClick={() => actions.removeSamples()}
              className="text-primary underline underline-offset-4"
            >
              Clear samples
            </button>
          </p>
        )}

        <div className="sheet mt-5 overflow-hidden rounded-lg">
          <div className="eyebrow hidden grid-cols-[5rem_1fr_7rem_7rem_8rem_8.5rem] gap-4 border-b-[1.5px] border-paper-line px-6 py-3 text-paper-muted md:grid">
            <span>No.</span>
            <span>Customer · work</span>
            <span>Due</span>
            <span className="text-right">Amount</span>
            <span>Status</span>
            <span />
          </div>
          {!hydrated ? (
            <div className="px-6 py-14 text-center text-paper-muted">Opening the ledger…</div>
          ) : rows.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <Feather className="mx-auto size-7 text-paper-muted" />
              <p className="text-display mt-3 text-xl">Nothing here yet</p>
              <p className="mt-1 text-sm text-paper-muted">
                Write your first invoice in one sentence.
              </p>
              <Button asChild variant="paper" className="mt-5">
                <Link to="/new">New invoice</Link>
              </Button>
            </div>
          ) : (
            <ul>
              {rows.map(({ inv, status, late }) => (
                <li
                  key={inv.id}
                  className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 border-b border-dashed border-paper-line px-6 py-4 last:border-b-0 transition-colors hover:bg-paper-shade md:grid-cols-[5rem_1fr_7rem_7rem_8rem_8.5rem]"
                >
                  <span className="num hidden text-xs text-paper-muted md:block">
                    {inv.invoice_number}
                  </span>
                  <Link to="/invoices/$id" params={{ id: inv.id }} className="min-w-0">
                    <span className="block truncate font-semibold">
                      {inv.customer_name}
                      {inv.sample && <span className="eyebrow ml-2 text-ink">sample</span>}
                    </span>
                    <span className="block truncate text-sm text-paper-muted">
                      {inv.description}
                    </span>
                  </Link>
                  <span className="num hidden text-sm md:block">{formatDate(inv.due_date)}</span>
                  <span className="num text-right text-base font-semibold">
                    {formatUsd(inv.amount)}
                  </span>
                  <span>
                    <StatusStamp status={status} days={late} />
                  </span>
                  <span className="text-right">
                    {status === "late" ? (
                      <Button asChild variant="paper" size="sm">
                        <Link to="/invoices/$id" params={{ id: inv.id }} search={{ remind: true }}>
                          Draft reminder
                        </Link>
                      </Button>
                    ) : (
                      <Link
                        to="/invoices/$id"
                        params={{ id: inv.id }}
                        className="inline-flex items-center gap-1 text-sm text-paper-muted hover:text-paper-foreground"
                      >
                        Open <ArrowRight className="size-3.5" />
                      </Link>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

function rank(s: DisplayStatus) {
  return { late: 0, waiting: 1, paid: 2, cancelled: 3 }[s];
}

function TallyRow({
  label,
  value,
  strong,
  late,
}: {
  label: string;
  value: string;
  strong?: boolean;
  late?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-3">
      <dt className={cn("text-sm", strong ? "font-semibold" : "text-paper-muted")}>{label}</dt>
      <span className="flex-1 translate-y-[-3px] border-b border-dotted border-paper-line" />
      <dd className={cn("num", strong ? "text-xl font-bold" : "text-sm", late && "text-late")}>
        {value}
      </dd>
    </div>
  );
}
