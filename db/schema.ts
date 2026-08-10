import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const integrationRecords = sqliteTable(
  "integration_records",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    source: text("source").notNull(),
    scope: text("scope").notNull(),
    entityType: text("entity_type").notNull(),
    externalId: text("external_id").notNull(),
    payload: text("payload").notNull(),
    sourceUpdatedAt: text("source_updated_at"),
    fetchedAt: integer("fetched_at").notNull(),
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

export const integrationSyncRuns = sqliteTable(
  "integration_sync_runs",
  {
    id: text("id").primaryKey(),
    source: text("source").notNull(),
    status: text("status").notNull(),
    startedAt: integer("started_at").notNull(),
    completedAt: integer("completed_at"),
    recordsSeen: integer("records_seen").notNull().default(0),
    recordsSaved: integer("records_saved").notNull().default(0),
    errorCount: integer("error_count").notNull().default(0),
    errors: text("errors"),
  },
  (table) => [
    index("idx_integration_sync_runs_source_started").on(
      table.source,
      table.startedAt,
    ),
  ],
);

export const monthlyPlans = sqliteTable("monthly_plans", {
  month: text("month").primaryKey(),
  newLeads: integer("new_leads").notNull(),
  noContactPercent: integer("no_contact_percent").notNull(),
  contactPercent: integer("contact_percent").notNull(),
  revenue: integer("revenue").notNull(),
  newSales: integer("new_sales").notNull(),
  repeatRevenue: integer("repeat_revenue").notNull(),
  updatedAt: integer("updated_at").notNull(),
});
