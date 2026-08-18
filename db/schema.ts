import {
  bigint,
  bigserial,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const integrationRecords = pgTable(
  "integration_records",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    source: text("source").notNull(),
    scope: text("scope").notNull(),
    entityType: text("entity_type").notNull(),
    externalId: text("external_id").notNull(),
    payload: jsonb("payload").notNull(),
    sourceUpdatedAt: text("source_updated_at"),
    fetchedAt: bigint("fetched_at", { mode: "number" }).notNull(),
    syncRunId: text("sync_run_id").notNull(),
  },
  (table) => [
    uniqueIndex("uq_integration_record_source_scope_entity_external").on(
      table.source,
      table.scope,
      table.entityType,
      table.externalId,
    ),
    index("idx_integration_records_source_entity").on(
      table.source,
      table.entityType,
    ),
    index("idx_integration_records_fetched_at").on(table.fetchedAt),
  ],
);

export const integrationSyncRuns = pgTable(
  "integration_sync_runs",
  {
    id: text("id").primaryKey(),
    source: text("source").notNull(),
    status: text("status").notNull(),
    startedAt: bigint("started_at", { mode: "number" }).notNull(),
    completedAt: bigint("completed_at", { mode: "number" }),
    recordsSeen: integer("records_seen").notNull().default(0),
    recordsSaved: integer("records_saved").notNull().default(0),
    errorCount: integer("error_count").notNull().default(0),
    errors: jsonb("errors"),
  },
  (table) => [
    index("idx_integration_sync_runs_source_started").on(
      table.source,
      table.startedAt,
    ),
  ],
);

export const monthlyPlans = pgTable("monthly_plans", {
  month: text("month").primaryKey(),
  newLeads: integer("new_leads").notNull(),
  noContactPercent: integer("no_contact_percent").notNull(),
  contactPercent: integer("contact_percent").notNull(),
  revenue: integer("revenue").notNull(),
  newSales: integer("new_sales").notNull(),
  repeatRevenue: integer("repeat_revenue").notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});

export const analyticsDailySnapshots = pgTable(
  "analytics_daily_snapshots",
  {
    snapshotDate: text("snapshot_date").notNull(),
    branchId: text("branch_id").notNull(),
    totalStudents: integer("total_students").notNull(),
    activeStudents: integer("active_students").notNull(),
    frozenStudents: integer("frozen_students").notNull(),
    finishedStudents: integer("finished_students").notNull(),
    bookingStudents: integer("booking_students").notNull(),
    revenue: bigint("revenue", { mode: "number" }).notNull(),
    paymentCount: integer("payment_count").notNull(),
    activeGroupCount: integer("active_group_count").notNull(),
    syncRunId: text("sync_run_id").notNull(),
  },
  (table) => [
    uniqueIndex("uq_analytics_snapshot_date_branch").on(
      table.snapshotDate,
      table.branchId,
    ),
  ],
);

export const teacherRates = pgTable(
  "teacher_rates",
  {
    branchId: text("branch_id").notNull(),
    teacherId: text("teacher_id").notNull(),
    teacherName: text("teacher_name").notNull(),
    hourlyRate: integer("hourly_rate").notNull().default(0),
    source: text("source").notNull().default("manual"),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.branchId, table.teacherId] }),
    index("idx_teacher_rates_name").on(table.teacherName),
  ],
);
