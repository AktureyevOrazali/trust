import {
  isSyncSource,
  triggerBackgroundSync,
} from "@/lib/integrations/sync";
import { serverEnv } from "@/lib/runtime/env";

export const dynamic = "force-dynamic";

function authorized(request: Request, secret: string | undefined): boolean {
  if (!secret) return false;
  return (
    request.headers.get("authorization") === `Bearer ${secret}` ||
    request.headers.get("x-sync-secret") === secret
  );
}

export async function POST(request: Request) {
  const runtime = serverEnv();
  if (!authorized(request, runtime.syncSecret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const requestedSource =
    new URL(request.url).searchParams.get("source") ?? "all";
  if (!isSyncSource(requestedSource)) {
    return Response.json(
      { error: "source must be amo, alfa, or all" },
      { status: 400 },
    );
  }

  await triggerBackgroundSync(requestedSource);
  return Response.json(
    { accepted: true, source: requestedSource },
    { status: 202 },
  );
}
