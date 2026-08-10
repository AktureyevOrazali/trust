import type { RawIntegrationRecord } from "./types";

const CREATE_RECORDS_TABLE = `
  CREATE TABLE IF NOT EXISTS integration_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    scope TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    external_id TEXT NOT NULL,
    payload TEXT NOT NULL,
    source_updated_at TEXT,
    fetched_at INTEGER NOT NULL,
    sync_run_id TEXT NOT NULL
  )
`;

const CREATE_RECORDS_UNIQUE_INDEX = `
  CREATE UNIQUE INDEX IF NOT EXISTS uq_integration_record_source_scope_entity_external
  ON integration_records(source, scope, entity_type, external_id)
`;

const CREATE_RECORDS_ENTITY_INDEX = `
  CREATE INDEX IF NOT EXISTS idx_integration_records_source_entity
  ON integration_records(source, entity_type)
`;

const CREATE_RECORDS_FETCHED_INDEX = `
  CREATE INDEX IF NOT EXISTS idx_integration_records_fetched_at
  ON integration_records(fetched_at)
`;

const CREATE_RUNS_TABLE = `
  CREATE TABLE IF NOT EXISTS integration_sync_runs (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    completed_at INTEGER,
    records_seen INTEGER NOT NULL DEFAULT 0,
    records_saved INTEGER NOT NULL DEFAULT 0,
    error_count INTEGER NOT NULL DEFAULT 0,
    errors TEXT
  )
`;

const CREATE_RUNS_INDEX = `
  CREATE INDEX IF NOT EXISTS idx_integration_sync_runs_source_started
  ON integration_sync_runs(source, started_at)
`;

export async function ensureIntegrationSchema(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare(CREATE_RECORDS_TABLE),
    db.prepare(CREATE_RECORDS_UNIQUE_INDEX),
    db.prepare(CREATE_RECORDS_ENTITY_INDEX),
    db.prepare(CREATE_RECORDS_FETCHED_INDEX),
    db.prepare(CREATE_RUNS_TABLE),
    db.prepare(CREATE_RUNS_INDEX),
  ]);
}

export async function startSyncRun(
  db: D1Database,
  source: string,
): Promise<string> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO integration_sync_runs
       (id, source, status, started_at, records_seen, records_saved, error_count)
       VALUES (?, ?, 'running', ?, 0, 0, 0)`,
    )
    .bind(id, source, Date.now())
    .run();
  return id;
}

export async function saveRawRecords(
  db: D1Database,
  runId: string,
  records: RawIntegrationRecord[],
): Promise<number> {
  const fetchedAt = Date.now();
  const statement = `
    INSERT INTO integration_records
      (source, scope, entity_type, external_id, payload, source_updated_at, fetched_at, sync_run_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source, scope, entity_type, external_id)
    DO UPDATE SET
      payload = excluded.payload,
      source_updated_at = excluded.source_updated_at,
      fetched_at = excluded.fetched_at,
      sync_run_id = excluded.sync_run_id
  `;

  for (let offset = 0; offset < records.length; offset += 50) {
    const chunk = records.slice(offset, offset + 50);
    await db.batch(
      chunk.map((record) =>
        db
          .prepare(statement)
          .bind(
            record.source,
            record.scope,
            record.entityType,
            record.externalId,
            JSON.stringify(record.payload),
            record.sourceUpdatedAt == null
              ? null
              : String(record.sourceUpdatedAt),
            fetchedAt,
            runId,
          ),
      ),
    );
  }

  return records.length;
}

export async function finishSyncRun(
  db: D1Database,
  runId: string,
  input: {
    status: "completed" | "completed_with_errors" | "failed";
    recordsSeen: number;
    recordsSaved: number;
    errors: unknown[];
  },
): Promise<void> {
  await db
    .prepare(
      `UPDATE integration_sync_runs
       SET status = ?, completed_at = ?, records_seen = ?, records_saved = ?,
           error_count = ?, errors = ?
       WHERE id = ?`,
    )
    .bind(
      input.status,
      Date.now(),
      input.recordsSeen,
      input.recordsSaved,
      input.errors.length,
      input.errors.length > 0 ? JSON.stringify(input.errors) : null,
      runId,
    )
    .run();
}
