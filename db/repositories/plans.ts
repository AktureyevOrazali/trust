import { eq, sql } from "drizzle-orm";

import type { MonthlyPlan } from "../../lib/dashboard/plan";
import { db } from "../index";
import { ensureLocalDatabaseSchema } from "../ensure-schema";
import { monthlyPlans } from "../schema";

export interface PlanRepository {
  get(month: string): Promise<MonthlyPlan | null>;
  save(plan: MonthlyPlan): Promise<void>;
}

export const planRepository: PlanRepository = {
  async get(month) {
    await ensureLocalDatabaseSchema();
    const rows = await db
      .select()
      .from(monthlyPlans)
      .where(eq(monthlyPlans.month, month))
      .limit(1);
    return rows[0] ?? null;
  },

  async save(plan) {
    await ensureLocalDatabaseSchema();
    await db
      .insert(monthlyPlans)
      .values(plan)
      .onConflictDoUpdate({
        target: monthlyPlans.month,
        set: {
          newLeads: sql`excluded.new_leads`,
          noContactPercent: sql`excluded.no_contact_percent`,
          contactPercent: sql`excluded.contact_percent`,
          revenue: sql`excluded.revenue`,
          newSales: sql`excluded.new_sales`,
          repeatRevenue: sql`excluded.repeat_revenue`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  },
};
