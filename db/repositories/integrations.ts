import { desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "../index.ts";
import { ensureLocalDatabaseSchema } from "../ensure-schema.ts";
import { integrationRecords, integrationSyncRuns } from "../schema.ts";
import type {
  IntegrationSource,
  RawIntegrationRecord,
} from "../../lib/integrations/types.ts";

export interface FinishSyncInput {
  status: "completed" | "completed_with_errors" | "failed";
  recordsSeen: number;
  recordsSaved: number;
  errors: unknown[];
}

export interface EntityCount {
  source: string;
  scope: string;
  entityType: string;
  count: number;
}

export interface SyncRunSummary {
  id: string;
  source: string;
  status: string;
  startedAt: number;
  completedAt: number | null;
  recordsSeen: number;
  recordsSaved: number;
  errorCount: number;
}

export interface IntegrationRepository {
  startRun(source: IntegrationSource): Promise<string>;
  saveRecords(runId: string, records: RawIntegrationRecord[]): Promise<number>;
  finishRun(runId: string, input: FinishSyncInput): Promise<void>;
  listPayloads(
    source: IntegrationSource,
    entityTypes: string[],
  ): Promise<
    Array<{
      scope: string;
      entityType: string;
      externalId: string;
      payload: unknown;
      fetchedAt: number;
    }>
  >;
  summary(): Promise<{ counts: EntityCount[]; runs: SyncRunSummary[] }>;
}

export const integrationRepository: IntegrationRepository = {
  async startRun(source) {
    await ensureLocalDatabaseSchema();
    const id = crypto.randomUUID();
    await db.insert(integrationSyncRuns).values({
      id,
      source,
      status: "running",
      startedAt: Date.now(),
    });
    return id;
  },

  async saveRecords(runId, records) {
    await ensureLocalDatabaseSchema();
    const fetchedAt = Date.now();

    for (let offset = 0; offset < records.length; offset += 100) {
      const chunk = records.slice(offset, offset + 100);
      if (chunk.length === 0) continue;

      await db
        .insert(integrationRecords)
        .values(
          chunk.map((record) => ({
            source: record.source,
            scope: record.scope,
            entityType: record.entityType,
            externalId: record.externalId,
            payload: record.payload,
            sourceUpdatedAt:
              record.sourceUpdatedAt == null
                ? null
                : String(record.sourceUpdatedAt),
            fetchedAt,
            syncRunId: runId,
          })),
        )
        .onConflictDoUpdate({
          target: [
            integrationRecords.source,
            integrationRecords.scope,
            integrationRecords.entityType,
            integrationRecords.externalId,
          ],
          set: {
            payload: sql`excluded.payload`,
            sourceUpdatedAt: sql`excluded.source_updated_at`,
            fetchedAt: sql`excluded.fetched_at`,
            syncRunId: sql`excluded.sync_run_id`,
          },
        });
    }

    return records.length;
  },

  async finishRun(runId, input) {
    await ensureLocalDatabaseSchema();
    await db
      .update(integrationSyncRuns)
      .set({
        status: input.status,
        completedAt: Date.now(),
        recordsSeen: input.recordsSeen,
        recordsSaved: input.recordsSaved,
        errorCount: input.errors.length,
        errors: input.errors.length > 0 ? input.errors : null,
      })
      .where(eq(integrationSyncRuns.id, runId));
  },

  async listPayloads(source, entityTypes) {
    await ensureLocalDatabaseSchema();
    if (entityTypes.length === 0) return [];
    return db
      .select({
        scope: integrationRecords.scope,
        entityType: integrationRecords.entityType,
        externalId: integrationRecords.externalId,
        payload: integrationRecords.payload,
        fetchedAt: integrationRecords.fetchedAt,
      })
      .from(integrationRecords)
      .where(
        sql`${integrationRecords.source} = ${source} AND ${inArray(
          integrationRecords.entityType,
          entityTypes,
        )}`,
      );
  },

  async summary() {
    await ensureLocalDatabaseSchema();
    const counts = await db
      .select({
        source: integrationRecords.source,
        scope: integrationRecords.scope,
        entityType: integrationRecords.entityType,
        count: sql<number>`count(*)::int`,
      })
      .from(integrationRecords)
      .groupBy(
        integrationRecords.source,
        integrationRecords.scope,
        integrationRecords.entityType,
      )
      .orderBy(
        integrationRecords.source,
        integrationRecords.entityType,
        integrationRecords.scope,
      );

    const runs = await db
      .select({
        id: integrationSyncRuns.id,
        source: integrationSyncRuns.source,
        status: integrationSyncRuns.status,
        startedAt: integrationSyncRuns.startedAt,
        completedAt: integrationSyncRuns.completedAt,
        recordsSeen: integrationSyncRuns.recordsSeen,
        recordsSaved: integrationSyncRuns.recordsSaved,
        errorCount: integrationSyncRuns.errorCount,
      })
      .from(integrationSyncRuns)
      .orderBy(desc(integrationSyncRuns.startedAt))
      .limit(20);

    return { counts, runs };
  },
};
