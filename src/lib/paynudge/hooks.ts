import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef } from "react";
import { getPaypalMode, syncInvoices } from "@/lib/paynudge/paynudge.functions";
import { actions, getState, useStore } from "./store";

export function usePaypalMode() {
  const fn = useServerFn(getPaypalMode);
  const q = useQuery({ queryKey: ["paypal-mode"], queryFn: () => fn(), staleTime: 60_000 });
  return { connected: q.data?.connected ?? false, loading: q.isLoading };
}

/** Re-check unpaid PayPal invoices every 10 seconds (backup for the webhook). */
export function useAutoSync() {
  const { invoices, hydrated } = useStore();
  const sync = useServerFn(syncInvoices);
  const busy = useRef(false);
  const pending = invoices.filter(
    (i) => i.source === "paypal" && i.status === "waiting" && i.paypal_invoice_id,
  );
  const ids = pending.map((i) => i.paypal_invoice_id as string).join(",");

  useEffect(() => {
    if (!hydrated || !ids) return;
    const run = async () => {
      if (busy.current || document.hidden) return;
      busy.current = true;
      try {
        await syncNow(sync, ids.split(","));
      } catch {
        /* network blip; next tick retries */
      } finally {
        busy.current = false;
      }
    };
    void run();
    const t = window.setInterval(run, 10_000);
    return () => window.clearInterval(t);
  }, [hydrated, ids, sync]);
}

export async function syncNow(
  sync: ReturnType<typeof useServerFn<typeof syncInvoices>>,
  paypalIds: string[],
) {
  if (paypalIds.length === 0) return 0;
  const fresh = await sync({ data: { ids: paypalIds } });
  const { invoices } = getState();
  let changed = 0;
  for (const f of fresh) {
    const local = invoices.find((i) => i.paypal_invoice_id === f.paypal_invoice_id);
    if (!local) continue;
    if (
      local.status !== f.status ||
      local.paypal_status !== f.paypal_status ||
      (f.pay_link && local.pay_link !== f.pay_link)
    ) {
      actions.updateInvoice(local.id, {
        status: f.status,
        paypal_status: f.paypal_status,
        pay_link: f.pay_link ?? local.pay_link,
        paid_at: f.status === "paid" ? (local.paid_at ?? f.paid_at) : null,
      });
      changed++;
    }
  }
  return changed;
}
