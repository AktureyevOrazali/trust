import { AlfaClient } from "@/lib/integrations/alfa";
import { AmoClient } from "@/lib/integrations/amo";
import {
  ensureIntegrationSchema,
  finishSyncRun,
  saveRawRecords,
  startSyncRun,
} from "@/lib/integrations/storage";
import { safeErrorMessage } from "@/lib/integrations/types";
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
  if (!(["amo", "alfa", "all"] as const).includes(
    requestedSource as "amo" | "alfa" | "all",
  )) {
    return Response.json(
      { error: "source must be amo, alfa, or all" },
      { status: 400 },
    );
  }

  await ensureIntegrationSchema();
  const summaries: unknown[] = [];

  const syncSource = async (
    source: "amo" | "alfa",
    discover: () => ReturnType<AmoClient["discoverAll"]>,
  ) => {
    const runId = await startSyncRun(source);
    try {
      const discovery = await discover();
      const saved = await saveRawRecords(runId, discovery.records);
      const status =
        discovery.errors.length > 0 ? "completed_with_errors" : "completed";
      await finishSyncRun(runId, {
        status,
        recordsSeen: discovery.records.length,
        recordsSaved: saved,
        errors: discovery.errors,
      });
      summaries.push({
        source,
        runId,
        status,
        records: saved,
        errors: discovery.errors,
      });
    } catch (error) {
      const message = safeErrorMessage(error);
      await finishSyncRun(runId, {
        status: "failed",
        recordsSeen: 0,
        recordsSaved: 0,
        errors: [{ message }],
      });
      summaries.push({ source, runId, status: "failed", error: message });
    }
  };

  if (requestedSource === "amo" || requestedSource === "all") {
    if (!runtime.amoBaseUrl || !runtime.amoAccessToken) {
      summaries.push({
        source: "amo",
        status: "not_configured",
        missing: [
          !runtime.amoBaseUrl ? "AMO_BASE_URL" : null,
          !runtime.amoAccessToken ? "AMO_ACCESS_TOKEN" : null,
        ].filter(Boolean),
      });
    } else {
      const client = new AmoClient(
        runtime.amoBaseUrl,
        runtime.amoAccessToken,
      );
      await syncSource("amo", () => client.discoverAll());
    }
  }

  if (requestedSource === "alfa" || requestedSource === "all") {
    if (!runtime.alfaBaseUrl || !runtime.alfaEmail || !runtime.alfaApiKey) {
      summaries.push({
        source: "alfa",
        status: "not_configured",
        missing: [
          !runtime.alfaBaseUrl ? "ALFA_BASE_URL" : null,
          !runtime.alfaEmail ? "ALFA_EMAIL" : null,
          !runtime.alfaApiKey ? "ALFA_API_KEY" : null,
        ].filter(Boolean),
      });
    } else {
      const client = new AlfaClient(
        runtime.alfaBaseUrl,
        runtime.alfaEmail,
        runtime.alfaApiKey,
        runtime.alfaBranchIds,
      );
      await syncSource("alfa", () => client.discoverAll());
    }
  }

  return Response.json({ summaries });
}
