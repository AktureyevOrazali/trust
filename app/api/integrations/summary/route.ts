import { integrationRepository } from "@/db/repositories/integrations";
import { serverEnv } from "@/lib/runtime/env";

export const dynamic = "force-dynamic";

function authorized(request: Request, secret: string | undefined): boolean {
  if (!secret) return false;
  return (
    request.headers.get("authorization") === `Bearer ${secret}` ||
    request.headers.get("x-sync-secret") === secret
  );
}

export async function GET(request: Request) {
  const runtime = serverEnv();
  if (!authorized(request, runtime.syncSecret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    return Response.json(await integrationRepository.summary());
  } catch {
    return Response.json(
      { error: "Postgres storage is unavailable" },
      { status: 503 },
    );
  }
}
