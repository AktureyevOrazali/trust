import { asc, eq, gte } from "drizzle-orm";

import { db } from "../index";
import { analyticsDailySnapshots, integrationRecords } from "../schema";

export type DailySnapshot = typeof analyticsDailySnapshots.$inferSelect;
export type DailySnapshotInput = typeof analyticsDailySnapshots.$inferInsert;

export interface AnalyticsRepository {
  listAlphaRecords(): Promise<
    Array<{
      scope: string;
      entityType: string;
      externalId: string;
      payload: unknown;
      fetchedAt: number;
    }>
  >;
  listDailySnapshots(fromDate: string): Promise<DailySnapshot[]>;
  saveDailySnapshot(snapshot: DailySnapshotInput): Promise<void>;
}

export const analyticsRepository: AnalyticsRepository = {
  listAlphaRecords() {
    return db
      .select({
        scope: integrationRecords.scope,
        entityType: integrationRecords.entityType,
        externalId: integrationRecords.externalId,
        payload: integrationRecords.payload,
        fetchedAt: integrationRecords.fetchedAt,
      })
      .from(integrationRecords)
      .where(eq(integrationRecords.source, "alfa"));
  },

  listDailySnapshots(fromDate) {
    return db
      .select()
      .from(analyticsDailySnapshots)
      .where(gte(analyticsDailySnapshots.snapshotDate, fromDate))
      .orderBy(
        asc(analyticsDailySnapshots.snapshotDate),
        asc(analyticsDailySnapshots.branchId),
      );
  },

  async saveDailySnapshot(snapshot) {
    await db
      .insert(analyticsDailySnapshots)
      .values(snapshot)
      .onConflictDoUpdate({
        target: [
          analyticsDailySnapshots.snapshotDate,
          analyticsDailySnapshots.branchId,
        ],
        set: snapshot,
      });
  },
};
