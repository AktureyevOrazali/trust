import { getDashboardData, type DashboardPeriod } from "@/lib/dashboard";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const search = new URL(request.url).searchParams;
  const requestedPeriod = search.get("period");
  const period: DashboardPeriod =
    requestedPeriod === "week" || requestedPeriod === "custom"
      ? requestedPeriod
      : "month";

  try {
    const data = await getDashboardData(
      period,
      search.get("from"),
      search.get("to"),
      search.get("force") === "1",
    );

    return Response.json(data, {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Некорректный период" },
      { status: 400 },
    );
  }
}
