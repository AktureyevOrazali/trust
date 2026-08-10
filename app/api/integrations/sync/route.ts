import { env } from "cloudflare:workers";
import { AmoClient } from "@/lib/integrations/amo";
import { AlfaClient } from "@/lib/integrations/alfa";
import {
  ensureIntegrationSchema,
  finishSyncRun,
  saveRawRecords,
  startSyncRun,
} from "@/lib/integrations/storage";
import { safeErrorMessage } from "@/lib/integrations/types";

export const dynamic = "force-dynamic";

type RuntimeEnv = {
  DB?: D1Database;
  SYNC_SECRET?: string;
  AMO_BASE_URL?: string;
  AMO_ACCESS_TOKEN?: string;
  ALFA_BASE_URL?: string;
  ALFA_EMAIL?: string;
  ALFA_API_KEY?: string;
  ALFA_BRANCH_IDS?: string;
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

export async function POST(request: Request) {
  const runtime = env as unknown as RuntimeEnv;
  if (!authorized(request, runtime)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!runtime.DB) {
    return Response.json({ error: "D1 binding DB is missing" }, { status: 503 });
  }

  const url = new URL(request.url);
  const requestedSource = url.searchParams.get("source") ?? "all";
  if (!["amo", "alfa", "all"].includes(requestedSource)) {
    return Response.json(
      { error: "source must be amo, alfa, or all" },
      { status: 400 },
    );
  }

  await ensureIntegrationSchema(runtime.DB);
  const summaries: unknown[] = [];

  const syncSource = async (
    source: "amo" | "alfa",
    discover: () => ReturnType<AmoClient["discoverAll"]>,
  ) => {
    const runId = await startSyncRun(runtime.DB!, source);
    try {
      const discovery = await discover();
      const saved = await saveRawRecords(
        runtime.DB!,
        runId,
        discovery.records,
      );
      const status =
        discovery.errors.length > 0 ? "completed_with_errors" : "completed";
      await finishSyncRun(runtime.DB!, runId, {
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
      await finishSyncRun(runtime.DB!, runId, {
        status: "failed",
        recordsSeen: 0,
        recordsSaved: 0,
        errors: [{ message }],
      });
      summaries.push({ source, runId, status: "failed", error: message });
    }
  };

  if (requestedSource === "amo" || requestedSource === "all") {
    if (!runtime.AMO_BASE_URL || !runtime.AMO_ACCESS_TOKEN) {
      summaries.push({
        source: "amo",
        status: "not_configured",
        missing: ["AMO_BASE_URL", "AMO_ACCESS_TOKEN"].filter(
          (key) => !runtime[key as keyof RuntimeEnv],
        ),
      });
    } else {
      const client = new AmoClient(
        runtime.AMO_BASE_URL,
        runtime.AMO_ACCESS_TOKEN,
      );
      await syncSource("amo", () => client.discoverAll());
    }
  }

  if (requestedSource === "alfa" || requestedSource === "all") {
    if (!runtime.ALFA_BASE_URL || !runtime.ALFA_EMAIL || !runtime.ALFA_API_KEY) {
      summaries.push({
        source: "alfa",
        status: "not_configured",
        missing: ["ALFA_BASE_URL", "ALFA_EMAIL", "ALFA_API_KEY"].filter(
          (key) => !runtime[key as keyof RuntimeEnv],
        ),
      });
    } else {
      const branchIds = (runtime.ALFA_BRANCH_IDS ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      const client = new AlfaClient(
        runtime.ALFA_BASE_URL,
        runtime.ALFA_EMAIL,
        runtime.ALFA_API_KEY,
        branchIds,
      );
      await syncSource("alfa", () => client.discoverAll());
    }
  }

  return Response.json({ summaries });
}
