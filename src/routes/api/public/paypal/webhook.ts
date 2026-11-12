import { createFileRoute } from "@tanstack/react-router";

// PayPal calls this when an invoice changes (e.g. INVOICING.INVOICE.PAID).
// We never trust the body: verify the signature with PayPal, then re-fetch the invoice.
// The matching invoice row is updated in the database. The dashboard also re-checks unpaid invoices every 10 seconds, so the status flips even without this.
export const Route = createFileRoute("/api/public/paypal/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { paypal, paypalConfigured, fetchInvoice } = await import("@/server/paypal.server");
        const webhookId = process.env["PAYPAL_WEBHOOK_ID"];
        if (!paypalConfigured() || !webhookId) {
          return new Response("Webhook not configured", { status: 503 });
        }
        const raw = await request.text();
        if (raw.length > 200_000) return new Response("Too large", { status: 413 });
        let event: { event_type?: string; resource?: { id?: string; invoice?: { id?: string } } };
        try {
          event = JSON.parse(raw);
        } catch {
          return new Response("Bad JSON", { status: 400 });
        }
        const h = (n: string) => request.headers.get(n);
        const fields = {
          auth_algo: h("paypal-auth-algo"),
          cert_url: h("paypal-cert-url"),
          transmission_id: h("paypal-transmission-id"),
          transmission_sig: h("paypal-transmission-sig"),
          transmission_time: h("paypal-transmission-time"),
        };
        if (Object.values(fields).some((v) => !v))
          return new Response("Missing headers", { status: 400 });
        try {
          const verified = await paypal<{ verification_status?: string }>(
            "/v1/notifications/verify-webhook-signature",
            {
              method: "POST",
              body: { ...fields, webhook_id: webhookId, webhook_event: event },
            },
          );
          if (verified.verification_status !== "SUCCESS")
            return new Response("Invalid signature", { status: 400 });
        } catch (e) {
          console.error("Webhook verification failed", e);
          return new Response("Verification failed", { status: 400 });
        }
        const id = event.resource?.invoice?.id ?? event.resource?.id;
        if (id && /^[A-Z0-9-]{3,60}$/i.test(id)) {
          try {
            const fresh = await fetchInvoice(id);
            // Signature verified and data re-fetched from PayPal, so a privileged write is safe here.
            const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
            const { error } = await supabaseAdmin
              .from("invoices")
              .update({
                status: fresh.status,
                paypal_status: fresh.paypal_status,
                pay_link: fresh.pay_link,
                paid_at: fresh.paid_at,
              })
              .eq("paypal_invoice_id", fresh.paypal_invoice_id);
            if (error) console.error("Webhook save failed", error.message);
            console.log(
              `PayPal webhook ${event.event_type}: invoice ${id} is ${fresh.paypal_status}`,
            );
          } catch (e) {
            console.error("Webhook re-fetch failed", e);
          }
        }
        return new Response(null, { status: 200 });
      },
    },
  },
});
