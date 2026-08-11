import { env } from "cloudflare:workers";
import { dashboardRange, periodStartKey } from "./period";

export interface MonthlyPlan {
  month: string;
  newLeads: number;
  noContactPercent: number;
  contactPercent: number;
  revenue: number;
  newSales: number;
  repeatRevenue: number;
  updatedAt: number;
}

export type MonthlyPlanInput = Omit<MonthlyPlan, "month" | "updatedAt">;

const CREATE_MONTHLY_PLANS_TABLE = `
  CREATE TABLE IF NOT EXISTS monthly_plans (
    month TEXT PRIMARY KEY,
    new_leads INTEGER NOT NULL,
    no_contact_percent INTEGER NOT NULL,
    contact_percent INTEGER NOT NULL,
    revenue INTEGER NOT NULL,
    new_sales INTEGER NOT NULL,
    repeat_revenue INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )
`;

const INITIAL_PLAN: MonthlyPlanInput = {
  newLeads: 825,
  noContactPercent: 25,
  contactPercent: 30,
  revenue: 4_350_000,
  newSales: 125,
  repeatRevenue: 2_000_000,
};

function currentMonth(): string {
  return periodStartKey(dashboardRange("month")).slice(0, 7);
}

function fallbackPlan(month: string): MonthlyPlan {
  return { month, ...INITIAL_PLAN, updatedAt: 0 };
}

async function ensurePlanSchema(db: D1Database): Promise<void> {
  await db.prepare(CREATE_MONTHLY_PLANS_TABLE).run();
}

function planFromRow(row: Record<string, unknown>): MonthlyPlan {
  return {
    month: String(row.month),
    newLeads: Number(row.new_leads),
    noContactPercent: Number(row.no_contact_percent),
    contactPercent: Number(row.contact_percent),
    revenue: Number(row.revenue),
    newSales: Number(row.new_sales),
    repeatRevenue: Number(row.repeat_revenue),
    updatedAt: Number(row.updated_at),
  };
}

export async function getCurrentMonthlyPlan(): Promise<MonthlyPlan> {
  const month = currentMonth();
  if (!env.DB) return fallbackPlan(month);

  await ensurePlanSchema(env.DB);
  const existing = await env.DB
    .prepare("SELECT * FROM monthly_plans WHERE month = ?")
    .bind(month)
    .first<Record<string, unknown>>();
  if (existing) return planFromRow(existing);

  const initial = fallbackPlan(month);
  await saveMonthlyPlan(env.DB, initial);
  return initial;
}

export async function saveCurrentMonthlyPlan(
  input: MonthlyPlanInput,
): Promise<MonthlyPlan> {
  const month = currentMonth();
  if (!env.DB) throw new Error("D1 database is unavailable");
  await ensurePlanSchema(env.DB);
  const plan: MonthlyPlan = { month, ...input, updatedAt: Date.now() };
  await saveMonthlyPlan(env.DB, plan);
  return plan;
}

async function saveMonthlyPlan(db: D1Database, plan: MonthlyPlan): Promise<void> {
  await db
    .prepare(
      `INSERT INTO monthly_plans
       (month, new_leads, no_contact_percent, contact_percent, revenue, new_sales, repeat_revenue, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(month) DO UPDATE SET
         new_leads = excluded.new_leads,
         no_contact_percent = excluded.no_contact_percent,
         contact_percent = excluded.contact_percent,
         revenue = excluded.revenue,
         new_sales = excluded.new_sales,
         repeat_revenue = excluded.repeat_revenue,
         updated_at = excluded.updated_at`,
    )
    .bind(
      plan.month,
      plan.newLeads,
      plan.noContactPercent,
      plan.contactPercent,
      plan.revenue,
      plan.newSales,
      plan.repeatRevenue,
      plan.updatedAt,
    )
    .run();
}
