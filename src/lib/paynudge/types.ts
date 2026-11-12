export type InvoiceItem = { name: string; quantity: number; unit_price: number };

export type InvoiceSource = "paypal" | "practice";
export type StoredStatus = "waiting" | "paid" | "cancelled";
export type DisplayStatus = "waiting" | "late" | "paid" | "cancelled";

export type Invoice = {
  id: string;
  source: InvoiceSource;
  paypal_invoice_id: string | null;
  invoice_number: string;
  customer_name: string;
  customer_email: string;
  description: string;
  items: InvoiceItem[];
  note: string;
  amount: number;
  currency: "USD";
  issue_date: string;
  due_date: string;
  status: StoredStatus;
  paypal_status: string | null;
  pay_link: string | null;
  paid_at: string | null;
  reminder_count: number;
  created_at: string;
  sample?: boolean;
};

export type ReminderTone = "heads-up" | "friendly" | "polite-clear" | "firm";

export type Reminder = {
  id: string;
  invoice_id: string;
  tone: ReminderTone;
  subject: string;
  body: string;
  status: "draft" | "sent";
  created_at: string;
  sent_at: string | null;
};

export type InvoiceDraft = {
  customer_name: string | null;
  customer_email: string | null;
  items: { name: string; quantity: number; unit_price: number | null }[];
  due_date: string | null;
  note: string | null;
  missing: string[];
};
