import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parseMonthlyPlans } from "../scripts/import-monthly-plans.mjs";

const row = {
  month: "2026-08",
  new_leads: 825,
  no_contact_percent: 25,
  contact_percent: 30,
  revenue: 4_350_000,
  new_sales: 125,
  repeat_revenue: 2_000_000,
  updated_at: 1_723_456_789_000,
};

test("maps sanitized D1 plan rows without changing values", () => {
  assert.deepEqual(parseMonthlyPlans(JSON.stringify({ results: [row] })), [
    {
      month: "2026-08",
      newLeads: 825,
      noContactPercent: 25,
      contactPercent: 30,
      revenue: 4_350_000,
      newSales: 125,
      repeatRevenue: 2_000_000,
      updatedAt: 1_723_456_789_000,
    },
  ]);
});

test("accepts Wrangler result envelopes and plain row arrays", () => {
  assert.equal(parseMonthlyPlans(JSON.stringify([{ results: [row] }])).length, 1);
  assert.equal(parseMonthlyPlans(JSON.stringify([row])).length, 1);
  assert.deepEqual(parseMonthlyPlans("[]"), []);
});

test("rejects invalid months, negative values, fractions, and duplicates", () => {
  assert.throws(
    () => parseMonthlyPlans(JSON.stringify([{ ...row, month: "2026-13" }])),
    /month/,
  );
  assert.throws(
    () => parseMonthlyPlans(JSON.stringify([{ ...row, revenue: -1 }])),
    /revenue/,
  );
  assert.throws(
    () => parseMonthlyPlans(JSON.stringify([{ ...row, new_sales: 1.5 }])),
    /new_sales/,
  );
  assert.throws(
    () => parseMonthlyPlans(JSON.stringify([row, row])),
    /повторяется/,
  );
});

test("writes all validated plans in one Postgres transaction", async () => {
  const source = await readFile("scripts/import-monthly-plans.mjs", "utf8");
  assert.match(source, /query\("BEGIN"\)/);
  assert.match(source, /query\("COMMIT"\)/);
  assert.match(source, /query\("ROLLBACK"\)/);
  assert.match(source, /ON CONFLICT \(month\) DO UPDATE/);
  assert.match(source, /VALUES \(\$1, \$2, \$3, \$4, \$5, \$6, \$7, \$8\)/);
});
