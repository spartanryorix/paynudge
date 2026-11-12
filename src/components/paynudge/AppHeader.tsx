import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Clock, FastForward, LogOut, RotateCcw } from "lucide-react";
import { actions, useStore, useToday } from "@/lib/paynudge/store";
import { formatDate } from "@/lib/paynudge/logic";
import { usePaypalMode } from "@/lib/paynudge/hooks";
import { cn } from "@/lib/utils";

export function AppHeader() {
  const { clockOffsetDays, hydrated, userId, email } = useStore();
  const qc = useQueryClient();
  const navigate = useNavigate();
  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }
  const today = useToday();
  const { connected, loading } = usePaypalMode();

  return (
    <header className="relative z-10 border-b border-border">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-8 gap-y-3 px-5 py-4">
        <Link to="/" className="group flex items-baseline gap-2">
          <span className="text-display text-2xl font-semibold italic">
            Pay<span className="text-primary">Nudge</span>
          </span>
          <span className="eyebrow hidden text-muted-foreground sm:inline">
            stop chasing payments
          </span>
        </Link>

        {userId && (
          <nav className="flex items-center gap-1 text-sm">
            <NavLink to="/">Ledger</NavLink>
            <NavLink to="/new">New invoice</NavLink>
          </nav>
        )}

        <div className="ml-auto flex flex-wrap items-center gap-3">
          <span
            className={cn(
              "eyebrow flex items-center gap-2 rounded-full border px-3 py-1.5",
              connected ? "border-primary/40 text-primary" : "border-border text-muted-foreground",
            )}
            title={
              connected
                ? "Invoices go to your PayPal sandbox"
                : "Connect PayPal to send real sandbox invoices"
            }
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                connected ? "bg-primary animate-pulse-dot" : "bg-muted-foreground",
              )}
            />
            {loading ? "checking…" : connected ? "PayPal sandbox" : "Practice mode"}
          </span>

          {userId && (
            <button
              type="button"
              onClick={signOut}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              title={email ?? undefined}
            >
              <LogOut className="size-3.5" /> Sign out
            </button>
          )}
          {userId && (
            <div className="flex items-center gap-1 rounded-full border border-border bg-secondary/50 p-1 pl-3">
              <Clock className="size-3.5 text-muted-foreground" />
              <span className="num text-xs">{hydrated ? formatDate(today) : "—"}</span>
              {clockOffsetDays > 0 && (
                <span className="num text-xs text-primary">+{clockOffsetDays}d</span>
              )}
              <button
                type="button"
                onClick={() => actions.shiftClock(12)}
                className="ml-1 flex items-center gap-1 rounded-full bg-primary/15 px-2.5 py-1 text-xs font-medium text-primary transition hover:bg-primary/25"
                title="Demo clock: jump 12 days ahead so invoices go late"
              >
                <FastForward className="size-3" /> 12 days
              </button>
              {clockOffsetDays > 0 && (
                <button
                  type="button"
                  onClick={() => actions.resetClock()}
                  className="rounded-full p-1.5 text-muted-foreground hover:text-foreground"
                  aria-label="Reset demo clock to today"
                  title="Back to real today"
                >
                  <RotateCcw className="size-3" />
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function NavLink({ to, children }: { to: "/" | "/new"; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      activeOptions={{ exact: true }}
      className="rounded-md px-3 py-1.5 text-muted-foreground transition hover:text-foreground data-[status=active]:bg-secondary data-[status=active]:text-foreground"
    >
      {children}
    </Link>
  );
}
