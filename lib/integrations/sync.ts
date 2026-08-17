import { integrationRepository } from "../../db/repositories/integrations.ts";
import type { IntegrationRepository } from "../../db/repositories/integrations.ts";
import { withSyncLock } from "../../db/sync-lock.ts";
import { serverEnv } from "../runtime/env.ts";
import type {
  DiscoveryResult,
  IntegrationEntityError,
  IntegrationSource,
} from "./types.ts";
import { safeErrorMessage } from "./types.ts";

export type SyncSource = IntegrationSource | "all";
export type SyncStatus =
  | "completed"
  | "completed_with_errors"
  | "failed"
  | "not_configured";

export interface SyncSummary {
  source: IntegrationSource;
  runId?: string;
  status: SyncStatus;
  records: number;
  errors: IntegrationEntityError[];
  missing?: string[];
}

interface SyncAdapter {
  configured: boolean;
  missing: string[];
  discover(): Promise<DiscoveryResult>;
}

export interface SynchronizationDependencies {
  repository: IntegrationRepository;
  adapters: Record<IntegrationSource, SyncAdapter>;
  withLock<T>(work: () => Promise<T>): Promise<T>;
  writeAlphaSnapshot(runId: string): Promise<void>;
}

export function isSyncSource(value: string): value is SyncSource {
  return value === "amo" || value === "alfa" || value === "all";
}

async function synchronizeOne(
  source: IntegrationSource,
  dependencies: SynchronizationDependencies,
): Promise<SyncSummary> {
  const adapter = dependencies.adapters[source];
  const runId = await dependencies.repository.startRun(source);
  if (!adapter.configured) {
    const errors: IntegrationEntityError[] = [
      {
        source,
        scope: "account",
        entityType: "configuration",
        message: `Missing environment variables: ${adapter.missing.join(", ")}`,
      },
    ];
    await dependencies.repository.finishRun(runId, {
      status: "failed",
      recordsSeen: 0,
      recordsSaved: 0,
      errors,
    });
    return {
      source,
      runId,
      status: "not_configured",
      records: 0,
      errors,
      missing: adapter.missing,
    };
  }

  try {
    const discovery = await adapter.discover();
    const saved = await dependencies.repository.saveRecords(
      runId,
      discovery.records,
    );
    const errors = [...discovery.errors];

    if (source === "alfa") {
      try {
        await dependencies.writeAlphaSnapshot(runId);
      } catch (error) {
        errors.push({
          source: "alfa",
          scope: "account",
          entityType: "analytics_snapshot",
          message: safeErrorMessage(error),
        });
      }
    }

    const status = errors.length > 0
      ? "completed_with_errors"
      : "completed";
    await dependencies.repository.finishRun(runId, {
      status,
      recordsSeen: discovery.records.length,
      recordsSaved: saved,
      errors,
    });

    return { source, runId, status, records: saved, errors };
  } catch (error) {
    const message = safeErrorMessage(error);
    const errors: IntegrationEntityError[] = [
      { source, scope: "account", entityType: "sync", message },
    ];
    await dependencies.repository.finishRun(runId, {
      status: "failed",
      recordsSeen: 0,
      recordsSaved: 0,
      errors,
    });
    return { source, runId, status: "failed", records: 0, errors };
  }
}

export async function runSynchronizationWithDependencies(
  source: SyncSource,
  dependencies: SynchronizationDependencies,
): Promise<SyncSummary[]> {
  return dependencies.withLock(async () => {
    const sources: IntegrationSource[] = source === "all"
      ? ["amo", "alfa"]
      : [source];
    const summaries: SyncSummary[] = [];

    for (const currentSource of sources) {
      summaries.push(await synchronizeOne(currentSource, dependencies));
    }

    return summaries;
  });
}

export function productionSyncDependencies(): SynchronizationDependencies {
  const runtime = serverEnv();
  const amoMissing = [
    !runtime.amoBaseUrl ? "AMO_BASE_URL" : null,
    !runtime.amoAccessToken ? "AMO_ACCESS_TOKEN" : null,
  ].filter((value): value is string => value !== null);
  const alfaMissing = [
    !runtime.alfaBaseUrl ? "ALFA_BASE_URL" : null,
    !runtime.alfaEmail ? "ALFA_EMAIL" : null,
    !runtime.alfaApiKey ? "ALFA_API_KEY" : null,
  ].filter((value): value is string => value !== null);

  return {
    repository: integrationRepository,
    withLock: withSyncLock,
    adapters: {
      amo: {
        configured: amoMissing.length === 0,
        missing: amoMissing,
        discover: async () => {
          const { AmoClient } = await import("./amo.ts");
          return new AmoClient(
            runtime.amoBaseUrl ?? "",
            runtime.amoAccessToken ?? "",
          ).discoverAll();
        },
      },
      alfa: {
        configured: alfaMissing.length === 0,
        missing: alfaMissing,
        discover: async () => {
          const { AlfaClient } = await import("./alfa.ts");
          return new AlfaClient(
            runtime.alfaBaseUrl ?? "",
            runtime.alfaEmail ?? "",
            runtime.alfaApiKey ?? "",
            runtime.alfaBranchIds,
          ).discoverAll();
        },
      },
    },
    writeAlphaSnapshot: async (runId) => {
      const { writeAlphaDailySnapshots } = await import(
        "../analytics/alpha-snapshot.ts"
      );
      await writeAlphaDailySnapshots(runId);
    },
  };
}

export function runSynchronization(
  source: SyncSource = "all",
): Promise<SyncSummary[]> {
  return runSynchronizationWithDependencies(source, productionSyncDependencies());
}

export async function triggerBackgroundSync(source: SyncSource): Promise<void> {
  const runtime = serverEnv();
  const response = await fetch(
    `${runtime.siteUrl}/api/internal/crm-sync-background?source=${source}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${runtime.syncSecret ?? ""}` },
    },
  );
  if (!response.ok && response.status !== 202) {
    throw new Error(`Sync trigger HTTP ${response.status}`);
  }
}
