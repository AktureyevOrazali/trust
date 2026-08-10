import {
  saveCurrentMonthlyPlan,
  type MonthlyPlanInput,
} from "@/lib/dashboard/plan";

export const dynamic = "force-dynamic";

const PLAN_FIELDS: Array<keyof MonthlyPlanInput> = [
  "newLeads",
  "noContactPercent",
  "contactPercent",
  "revenue",
  "newSales",
  "repeatRevenue",
];

export async function PUT(request: Request) {
  const body = (await request.json()) as Record<string, unknown>;
  const input = {} as MonthlyPlanInput;

  for (const field of PLAN_FIELDS) {
    const value = Number(body[field]);
    if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
      return Response.json({ error: `Invalid ${field}` }, { status: 400 });
    }
    input[field] = value;
  }

  try {
    const plan = await saveCurrentMonthlyPlan(input);
    return Response.json({ plan });
  } catch {
    return Response.json({ error: "Plan storage is unavailable" }, { status: 503 });
  }
}
