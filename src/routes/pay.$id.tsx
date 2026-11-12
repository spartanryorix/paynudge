import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusStamp } from "@/components/paynudge/StatusStamp";
import { supabase } from "@/integrations/supabase/client";
import { formatDate, formatUsd } from "@/lib/paynudge/logic";
import { reload } from "@/lib/paynudge/store";

export const Route = createFileRoute("/pay/$id")({
  head: () => ({
    meta: [
      { title: "Pay invoice — PayNudge" },
      { name: "description", content: "Practice pay page for a PayNudge invoice." },
      { property: "og:title", content: "Pay invoice — PayNudge" },
      { property: "og:description", content: "Practice pay page for a PayNudge invoice." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PayPage,
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function PayPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ["pay-page", id],
    enabled: UUID.test(id),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_pay_page", { _id: id });
      if (error) throw new Error(error.message);
      return data?.[0] ?? null;
    },
  });

  if (!UUID.test(id) || (q.isSuccess && !q.data)) {
    return (
      <div className="py-24 text-center text-muted-foreground">This pay link isn't valid.</div>
    );
  }
  if (q.isLoading) return <div className="py-24 text-center text-muted-foreground">Loading…</div>;
  if (q.isError || !q.data)
    return (
      <div className="py-24 text-center text-muted-foreground">
        Couldn't open this invoice. Try again in a moment.
      </div>
    );
  const inv = q.data;
  const paid = inv.status === "paid";

  if (inv.source === "paypal" && inv.pay_link) {
    return (
      <div className="mx-auto max-w-md px-5 py-24 text-center">
        <p className="text-muted-foreground">This invoice is paid through PayPal.</p>
        <Button asChild variant="mint" className="mt-5">
          <a href={inv.pay_link}>Go to PayPal</a>
        </Button>
      </div>
    );
  }

  async function onPay() {
    setPaying(true);
    setError(null);
    const { error } = await supabase.rpc("pay_practice_invoice", { _id: id });
    if (error) setError("Payment didn't go through. Try again.");
    await qc.invalidateQueries({ queryKey: ["pay-page", id] });
    void reload();
    setPaying(false);
  }

  return (
    <div className="mx-auto max-w-md px-5 py-14">
      <p className="eyebrow text-center text-muted-foreground">
        Practice pay page · what your customer sees
      </p>
      <div className="paper mt-4 px-8 py-10 text-center">
        <p className="eyebrow text-paper-muted">{inv.invoice_number}</p>
        <p className="mt-4 text-sm text-paper-muted">
          Hi {inv.customer_name.split(" ")[0]}, you owe
        </p>
        <p className="num mt-1 text-5xl font-bold">{formatUsd(Number(inv.amount))}</p>
        <p className="mt-2 text-sm text-paper-muted">for {inv.description}</p>
        <p className="num mt-1 text-xs text-paper-muted">due {formatDate(inv.due_date)}</p>
        <div className="perforation my-7" />
        {paid ? (
          <StatusStamp status="paid" size="xl" />
        ) : (
          <Button variant="paper" size="xl" className="w-full" disabled={paying} onClick={onPay}>
            <Lock /> {paying ? "Processing…" : "Pay now (practice)"}
          </Button>
        )}
        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
        <p className="mt-4 text-xs text-paper-muted">
          No real money moves. Real invoices use PayPal's own pay page.
        </p>
      </div>
    </div>
  );
}
