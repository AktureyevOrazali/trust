import { sql } from "drizzle-orm";

import { db } from "./index.ts";

let localSchemaPromise: Promise<void> | undefined;

async function createLocalSchema(): Promise<void> {
  // Deploys use the versioned migration in netlify/database/migrations.
  // Netlify CLI does not discover migrations from a nested Git worktree, so
  // local development bootstraps the same idempotent schema here.
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS integration_records (
      id bigserial PRIMARY KEY,
      source text NOT NULL,
      scope text NOT NULL,
      entity_type text NOT NULL,
      external_id text NOT NULL,
      payload jsonb NOT NULL,
      source_updated_at text,
      fetched_at bigint NOT NULL,
      sync_run_id text NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_integration_record_source_scope_entity_external
      ON integration_records (source, scope, entity_type, external_id);
    CREATE INDEX IF NOT EXISTS idx_integration_records_source_entity
      ON integration_records (source, entity_type);
    CREATE INDEX IF NOT EXISTS idx_integration_records_fetched_at
      ON integration_records (fetched_at);

    CREATE TABLE IF NOT EXISTS integration_sync_runs (
      id text PRIMARY KEY,
      source text NOT NULL,
      status text NOT NULL,
      started_at bigint NOT NULL,
      completed_at bigint,
      records_seen integer NOT NULL DEFAULT 0,
      records_saved integer NOT NULL DEFAULT 0,
      error_count integer NOT NULL DEFAULT 0,
      errors jsonb
    );
    CREATE INDEX IF NOT EXISTS idx_integration_sync_runs_source_started
      ON integration_sync_runs (source, started_at);

    CREATE TABLE IF NOT EXISTS monthly_plans (
      month text PRIMARY KEY,
      new_leads integer NOT NULL,
      no_contact_percent integer NOT NULL,
      contact_percent integer NOT NULL,
      revenue integer NOT NULL,
      new_sales integer NOT NULL,
      repeat_revenue integer NOT NULL,
      updated_at bigint NOT NULL
    );

    CREATE TABLE IF NOT EXISTS analytics_daily_snapshots (
      snapshot_date text NOT NULL,
      branch_id text NOT NULL,
      total_students integer NOT NULL,
      active_students integer NOT NULL,
      frozen_students integer NOT NULL,
      finished_students integer NOT NULL,
      booking_students integer NOT NULL,
      revenue bigint NOT NULL,
      payment_count integer NOT NULL,
      active_group_count integer NOT NULL,
      sync_run_id text NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_analytics_snapshot_date_branch
      ON analytics_daily_snapshots (snapshot_date, branch_id);
  `));
}

export async function ensureLocalDatabaseSchema(): Promise<void> {
  if (process.env.NETLIFY_LOCAL !== "true") return;

  localSchemaPromise ??= createLocalSchema().catch((error) => {
    localSchemaPromise = undefined;
    throw error;
  });
  await localSchemaPromise;
}
