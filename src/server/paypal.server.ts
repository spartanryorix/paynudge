// Server-only PayPal helper. Calls go through the Lovable connector gateway (sandbox).
const GATEWAY_URL = "https://connector-gateway.lovable.dev/paypal";

export function paypalConfigured(): boolean {
  return Boolean(process.env["LOVABLE_API_KEY"] && process.env["PAYPAL_API_KEY"]);
}

export async function paypal<T = Record<string, unknown>>(
  path: string,
  init: { method?: string; body?: unknown; requestId?: string } = {},
): Promise<T> {
  const lovableKey = process.env["LOVABLE_API_KEY"];
  const paypalKey = process.env["PAYPAL_API_KEY"];
  if (!lovableKey || !paypalKey) {
    throw new Error(
      "PayPal isn't connected yet. Connect your PayPal sandbox account to send real invoices.",
    );
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${lovableKey}`,
    "X-Connection-Api-Key": paypalKey,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (init.requestId) headers["PayPal-Request-Id"] = init.requestId;
  const res = await fetch(`${GATEWAY_URL}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? null : JSON.stringify(init.body),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`PayPal ${res.status} on ${path}: ${text}`);
    throw new Error(`PayPal said no (${res.status}): ${summarizePaypalError(text)}`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

function summarizePaypalError(text: string): string {
  try {
    const j = JSON.parse(text) as {
      message?: string;
      details?: { issue?: string; description?: string; field?: string }[];
    };
    const d = j.details?.[0];
    if (d) return [d.description ?? d.issue, d.field].filter(Boolean).join(" — ");
    return j.message ?? text.slice(0, 200);
  } catch {
    return text.slice(0, 200);
  }
}

export type PaypalInvoice = {
  id: string;
  status: string;
  detail?: {
    invoice_number?: string;
    metadata?: { recipient_view_url?: string; invoicer_view_url?: string };
  };
  payments?: { transactions?: { payment_date?: string }[] };
  amount?: { value?: string; currency_code?: string };
  due_amount?: { value?: string; currency_code?: string };
};

const PAID = new Set(["PAID", "MARKED_AS_PAID"]);
const CLOSED = new Set(["CANCELLED", "REFUNDED", "MARKED_AS_REFUNDED"]);

export function mapStatus(s: string): "paid" | "cancelled" | "waiting" {
  if (PAID.has(s)) return "paid";
  if (CLOSED.has(s)) return "cancelled";
  return "waiting";
}

export async function fetchInvoice(id: string) {
  const inv = await paypal<PaypalInvoice>(`/v2/invoicing/invoices/${encodeURIComponent(id)}`);
  const lastPay = inv.payments?.transactions?.at(-1)?.payment_date ?? null;
  return {
    paypal_invoice_id: inv.id,
    paypal_status: inv.status,
    status: mapStatus(inv.status),
    pay_link: inv.detail?.metadata?.recipient_view_url ?? null,
    paid_at:
      mapStatus(inv.status) === "paid"
        ? lastPay
          ? `${lastPay.slice(0, 10)}T12:00:00.000Z`
          : new Date().toISOString()
        : null,
  };
}
