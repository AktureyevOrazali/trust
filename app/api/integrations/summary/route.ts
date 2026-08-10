import { env } from "cloudflare:workers";

export const dynamic = "force-dynamic";

type RuntimeEnv = {
  DB?: D1Database;
  SYNC_SECRET?: string;
};

function authorized(request: Request, runtime: RuntimeEnv): boolean {
  if (!runtime.SYNC_SECRET) return false;
  const bearer = request.headers.get("authorization");
  const direct = request.headers.get("x-sync-secret");
  return (
    bearer === `Bearer ${runtime.SYNC_SECRET}` ||
    direct === runtime.SYNC_SECRET
  );
}

export async function GET(request: Request) {
  const runtime = env as unknown as RuntimeEnv;
  if (!authorized(request, runtime)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!runtime.DB) {
    return Response.json({ error: "D1 binding DB is missing" }, { status: 503 });
  }

  const counts = await runtime.DB.prepare(
    `SELECT source, scope, entity_type, COUNT(*) AS count
     FROM integration_records
     GROUP BY source, scope, entity_type
     ORDER BY source, entity_type, scope`,
  ).all();
  const runs = await runtime.DB.prepare(
    `SELECT id, source, status, started_at, completed_at, records_seen,
            records_saved, error_count
     FROM integration_sync_runs
     ORDER BY started_at DESC
     LIMIT 20`,
  ).all();

  return Response.json({
    counts: counts.results,
    runs: runs.results,
  });
}
