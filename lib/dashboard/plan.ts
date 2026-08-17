import { planRepository } from "@/db/repositories/plans";
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

export const INITIAL_PLAN: MonthlyPlanInput = {
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

export async function getCurrentMonthlyPlan(): Promise<MonthlyPlan> {
  const month = currentMonth();

  try {
    const existing = await planRepository.get(month);
    if (existing) return existing;

    const initial = fallbackPlan(month);
    await planRepository.save(initial);
    return initial;
  } catch {
    return fallbackPlan(month);
  }
}

export async function saveCurrentMonthlyPlan(
  input: MonthlyPlanInput,
): Promise<MonthlyPlan> {
  const plan: MonthlyPlan = {
    month: currentMonth(),
    ...input,
    updatedAt: Date.now(),
  };
  await planRepository.save(plan);
  return plan;
}
