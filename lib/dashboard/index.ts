import {
  getAmoDashboardData,
  type AmoDashboardData,
} from "./amo";
import {
  getAlfaDashboardData,
  type AlfaDashboardData,
} from "./alfa";
import type { DashboardPeriod } from "./period";
import { getCurrentMonthlyPlan, type MonthlyPlan } from "./plan";

export type { DashboardPeriod } from "./period";

export interface DashboardData extends AmoDashboardData {
  alfa: AlfaDashboardData;
  plan: MonthlyPlan;
}

export async function getDashboardData(
  period: DashboardPeriod = "month",
): Promise<DashboardData> {
  const [amo, alfa, plan] = await Promise.all([
    getAmoDashboardData(period),
    getAlfaDashboardData(period),
    getCurrentMonthlyPlan(),
  ]);
  return { ...amo, alfa, plan };
}
