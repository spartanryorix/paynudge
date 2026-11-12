import { describe, expect, it } from "vitest";
import {
  daysLate,
  displayStatus,
  itemsTotal,
  missingFields,
  toneFor,
  weeklyNumbers,
} from "./logic";
import type { Invoice } from "./types";

const inv = (p: Partial<Invoice>): Invoice => ({
  id: "x",
  source: "practice",
  paypal_invoice_id: null,
  invoice_number: "PN-1",
  customer_name: "Sara",
  customer_email: "sara@email.com",
  description: "Logo",
  items: [],
  note: "",
  amount: 300,
  currency: "USD",
  issue_date: "2026-11-01",
  due_date: "2026-11-10",
  status: "waiting",
  paypal_status: null,
  pay_link: null,
  paid_at: null,
  reminder_count: 0,
  created_at: "2026-11-01T00:00:00Z",
  ...p,
});

describe("reminder tone is picked by days late", () => {
  it("not late yet → friendly heads-up", () => expect(toneFor(0)).toBe("heads-up"));
  it("1 day late → friendly", () => expect(toneFor(1)).toBe("friendly"));
  it("3 days late → friendly", () => expect(toneFor(3)).toBe("friendly"));
  it("4 days late → polite but clear", () => expect(toneFor(4)).toBe("polite-clear"));
  it("10 days late → polite but clear", () => expect(toneFor(10)).toBe("polite-clear"));
  it("12 days late → firm but respectful", () => expect(toneFor(12)).toBe("firm"));
});

describe("late is today past the due date and unpaid", () => {
  it("counts days past due", () => expect(daysLate("2026-11-10", "2026-11-22")).toBe(12));
  it("is 0 on the due date", () => expect(daysLate("2026-11-10", "2026-11-10")).toBe(0));
  it("unpaid and past due shows late", () =>
    expect(displayStatus(inv({}), "2026-11-11")).toBe("late"));
  it("paid never shows late", () =>
    expect(displayStatus(inv({ status: "paid" }), "2026-12-30")).toBe("paid"));
});

describe("code does the math", () => {
  it("totals items as quantity × price", () =>
    expect(
      itemsTotal([
        { name: "a", quantity: 4, unit_price: 40 },
        { name: "b", quantity: 1, unit_price: 20.5 },
      ]),
    ).toBe(180.5));

  it("weekly numbers: owed, late, expected", () => {
    const today = "2026-11-11";
    const n = weeklyNumbers(
      [
        inv({ id: "1", amount: 300, due_date: "2026-10-30", customer_name: "Sara" }),
        inv({ id: "2", amount: 600, due_date: "2026-11-15" }),
        inv({ id: "3", amount: 100, status: "paid", paid_at: "2026-11-09T10:00:00Z" }),
      ],
      today,
    );
    expect(n.owed).toBe(900);
    expect(n.late).toEqual([{ name: "Sara", amount: 300, days: 12 }]);
    expect(n.expectedThisWeek).toBe(600);
    expect(n.paidThisWeek).toBe(100);
  });
});

describe("missing fields block sending", () => {
  it("flags missing email and price", () => {
    const m = missingFields(
      {
        customer_name: "Sara",
        customer_email: "",
        due_date: "2026-11-20",
        items: [{ name: "Logo", quantity: 1, unit_price: null }],
      },
      "2026-11-11",
    );
    expect(m).toEqual(["customer_email", "items.0.unit_price"]);
  });
  it("flags a past due date", () => {
    const m = missingFields(
      {
        customer_name: "Sara",
        customer_email: "s@e.co",
        due_date: "2026-11-01",
        items: [{ name: "Logo", quantity: 1, unit_price: 300 }],
      },
      "2026-11-11",
    );
    expect(m).toEqual(["due_date"]);
  });
});
