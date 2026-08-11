import {
  getAmoDashboardData,
  type AmoDashboardData,
} from "./amo";
import {
  getAlfaDashboardData,
  type AlfaDashboardData,
} from "./alfa";
import {
  dashboardRange,
  type DashboardPeriod,
  type DashboardRange,
} from "./period";
import { getCurrentMonthlyPlan, type MonthlyPlan } from "./plan";

export type { DashboardPeriod, DashboardRange } from "./period";

export interface DashboardData extends AmoDashboardData {
  alfa: AlfaDashboardData;
  plan: MonthlyPlan;
  range: DashboardRange;
}

export async function getDashboardData(
  period: DashboardPeriod = "month",
  requestedFrom?: string | null,
  requestedTo?: string | null,
  forceRefresh = false,
): Promise<DashboardData> {
  const range = dashboardRange(period, requestedFrom, requestedTo);
  const [amo, alfa, plan] = await Promise.all([
    getAmoDashboardData(range, forceRefresh),
    getAlfaDashboardData(range, forceRefresh),
    getCurrentMonthlyPlan(),
  ]);
  return { ...amo, alfa, plan, range };
}
