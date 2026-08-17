import assert from "node:assert/strict";
import test from "node:test";
import { getTableConfig } from "drizzle-orm/pg-core";

import * as schema from "../db/schema.ts";

test("stores integration payloads as Postgres jsonb", () => {
  const config = getTableConfig(schema.integrationRecords);
  const payload = config.columns.find((column) => column.name === "payload");

  assert.equal(config.name, "integration_records");
  assert.equal(payload?.getSQLType(), "jsonb");
  assert.ok(
    config.indexes.some(
      (candidate) =>
        candidate.config.unique &&
        candidate.config.columns
          .map((column) => Reflect.get(column, "name"))
          .join(",") ===
        "source,scope,entity_type,external_id",
    ),
  );
});

test("defines Postgres tables for sync runs, plans, and daily snapshots", () => {
  assert.equal(getTableConfig(schema.integrationSyncRuns).name, "integration_sync_runs");
  assert.equal(getTableConfig(schema.monthlyPlans).name, "monthly_plans");

  assert.ok("analyticsDailySnapshots" in schema);
  const snapshots = getTableConfig(schema.analyticsDailySnapshots);
  assert.equal(snapshots.name, "analytics_daily_snapshots");
  assert.ok(
    snapshots.indexes.some(
      (candidate) =>
        candidate.config.unique &&
        candidate.config.columns
          .map((column) => Reflect.get(column, "name"))
          .join(",") ===
        "snapshot_date,branch_id",
    ),
  );
});
