import {
  InvalidAnalyticsFilterError,
  parseAnalyticsFilters,
} from "@/lib/analytics/filters";
import { getStudentsDashboard } from "@/lib/analytics/students";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const filters = parseAnalyticsFilters(new URL(request.url).searchParams);
    return Response.json(await getStudentsDashboard(filters), {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    if (error instanceof InvalidAnalyticsFilterError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    return Response.json(
      { error: "Данные учеников временно недоступны. Попробуйте позже." },
      { status: 503 },
    );
  }
}
