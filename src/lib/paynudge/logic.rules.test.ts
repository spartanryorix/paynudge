import { describe, expect, it } from "vitest";
import {
  addDays,
  daysBetween,
  daysLate,
  displayStatus,
  isEmail,
  itemsTotal,
  missingFields,
  toneFor,
  weeklyNumbers,
} from "./logic";
import type { Invoice } from "./types";

function invoice(over: Partial<Invoice>): Invoice {
  return {
    id: "1",
    source: "practice",
    paypal_invoice_id: null,
    invoice_number: "INV-1",
    customer_name: "Ali",
    customer_email: "ali@example.com",
    description: "Logo design",
    items: [{ name: "Logo", quantity: 1, unit_price: 100 }],
    note: "",
    amount: 100,
    currency: "USD",
    issue_date: "2026-11-01",
    due_date: "2026-11-10",
    status: "waiting",
    paypal_status: null,
    pay_link: null,
    paid_at: null,
    reminder_count: 0,
    created_at: "2026-11-01T00:00:00.000Z",
    ...over,
  };
}

describe("dates", () => {
  it("adds days across a month boundary", () => {
    expect(addDays("2026-11-28", 5)).toBe("2026-12-03");
  });
  it("counts whole days between dates", () => {
    expect(daysBetween("2026-11-01", "2026-11-11")).toBe(10);
  });
  it("never reports negative lateness", () => {
    expect(daysLate("2026-11-20", "2026-11-12")).toBe(0);
    expect(daysLate("2026-11-10", "2026-11-12")).toBe(2);
  });
});

describe("reminder tone is chosen by code", () => {
  it("scales with how late the invoice is", () => {
    expect(toneFor(0)).toBe("heads-up");
    expect(toneFor(1)).toBe("friendly");
    expect(toneFor(3)).toBe("friendly");
    expect(toneFor(4)).toBe("polite-clear");
    expect(toneFor(10)).toBe("polite-clear");
    expect(toneFor(11)).toBe("firm");
  });
});

describe("invoice status", () => {
  it("is late only after the due date", () => {
    expect(displayStatus(invoice({}), "2026-11-10")).toBe("waiting");
    expect(displayStatus(invoice({}), "2026-11-11")).toBe("late");
  });
  it("paid and cancelled win over lateness", () => {
    expect(displayStatus(invoice({ status: "paid" }), "2026-12-01")).toBe("paid");
    expect(displayStatus(invoice({ status: "cancelled" }), "2026-12-01")).toBe("cancelled");
  });
});

describe("totals", () => {
  it("sums line items and rounds to cents", () => {
    expect(
      itemsTotal([
        { name: "A", quantity: 3, unit_price: 0.1 },
        { name: "B", quantity: 2, unit_price: 49.99 },
      ]),
    ).toBe(100.28);
  });
});

describe("weekly numbers", () => {
  it("separates owed, late, paid and expected money", () => {
    const today = "2026-11-12";
    const nums = weeklyNumbers(
      [
        invoice({ id: "a", amount: 200, due_date: "2026-11-02" }), // 10 days late
        invoice({ id: "b", amount: 50, due_date: "2026-11-09" }), // 3 days late
        invoice({ id: "c", amount: 300, due_date: "2026-11-15" }), // due this week
        invoice({ id: "d", amount: 75, status: "paid", paid_at: "2026-11-10T12:00:00.000Z" }),
        invoice({ id: "e", amount: 999, status: "cancelled" }),
      ],
      today,
    );
    expect(nums.owed).toBe(550);
    expect(nums.waitingCount).toBe(3);
    expect(nums.paidThisWeek).toBe(75);
    expect(nums.expectedThisWeek).toBe(300);
    expect(nums.late.map((l) => l.days)).toEqual([10, 3]);
  });
});

describe("validation helpers", () => {
  it("checks email shape", () => {
    expect(isEmail("a@b.co")).toBe(true);
    expect(isEmail("not-an-email")).toBe(false);
  });
  it("lists what is missing before an invoice can be sent", () => {
    const missing = missingFields(
      {
        customer_name: "",
        customer_email: "nope",
        items: [{ name: "Logo", quantity: 1, unit_price: null }],
        due_date: "2026-11-01",
      },
      "2026-11-12",
    );
    expect(missing).toEqual(["customer_name", "customer_email", "due_date", "items.0.unit_price"]);
  });
  it("returns nothing missing for a complete form", () => {
    expect(
      missingFields(
        {
          customer_name: "Ali",
          customer_email: "ali@example.com",
          items: [{ name: "Logo", quantity: 1, unit_price: 100 }],
          due_date: "2026-11-20",
        },
        "2026-11-12",
      ),
    ).toEqual([]);
  });
});
