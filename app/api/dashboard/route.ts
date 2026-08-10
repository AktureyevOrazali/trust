import { getDashboardData, type DashboardPeriod } from "@/lib/dashboard";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestedPeriod = new URL(request.url).searchParams.get("period");
  const period: DashboardPeriod = requestedPeriod === "week" ? "week" : "month";
  const data = await getDashboardData(period);

  return Response.json(data, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
