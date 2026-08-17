import { integrationRepository } from "@/db/repositories/integrations";
import type { IntegrationSource, RawIntegrationRecord } from "./types";

export async function ensureIntegrationSchema(): Promise<void> {
  // Netlify applies versioned Postgres migrations before the deployment starts.
}

export function startSyncRun(source: IntegrationSource): Promise<string> {
  return integrationRepository.startRun(source);
}

export function saveRawRecords(
  runId: string,
  records: RawIntegrationRecord[],
): Promise<number> {
  return integrationRepository.saveRecords(runId, records);
}

export function finishSyncRun(
  runId: string,
  input: {
    status: "completed" | "completed_with_errors" | "failed";
    recordsSeen: number;
    recordsSaved: number;
    errors: unknown[];
  },
): Promise<void> {
  return integrationRepository.finishRun(runId, input);
}
