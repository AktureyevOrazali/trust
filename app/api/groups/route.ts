import {
  InvalidAnalyticsFilterError,
  parseAnalyticsFilters,
} from "@/lib/analytics/filters";
import { getGroupsDashboard } from "@/lib/analytics/groups";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const filters = parseAnalyticsFilters(new URL(request.url).searchParams);
    return Response.json(await getGroupsDashboard(filters), {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    if (error instanceof InvalidAnalyticsFilterError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    return Response.json(
      { error: "Данные групп временно недоступны. Попробуйте позже." },
      { status: 503 },
    );
  }
}
