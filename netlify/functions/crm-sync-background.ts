import type { Config } from "@netlify/functions";

import { isSyncSource, runSynchronization } from "../../lib/integrations/sync.ts";
import { serverEnv } from "../../lib/runtime/env.ts";

function authorized(request: Request, secret: string | undefined): boolean {
  return Boolean(
    secret && request.headers.get("authorization") === `Bearer ${secret}`,
  );
}

export default async function handler(request: Request): Promise<Response> {
  const runtime = serverEnv();
  if (!authorized(request, runtime.syncSecret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const source = new URL(request.url).searchParams.get("source") ?? "all";
  if (!isSyncSource(source)) {
    return Response.json(
      { error: "source must be amo, alfa, or all" },
      { status: 400 },
    );
  }

  return Response.json({ summaries: await runSynchronization(source) });
}

export const config: Config = {
  background: true,
  path: "/api/internal/crm-sync-background",
};
