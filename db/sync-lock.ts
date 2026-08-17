import { getConnectionString } from "@netlify/database";
import pg from "pg";

const SYNC_LOCK_ID = 72_667_001;
let lockPool: pg.Pool | undefined;

function pool(): pg.Pool {
  lockPool ??= new pg.Pool({ connectionString: getConnectionString() });
  return lockPool;
}

export async function withSyncLock<T>(work: () => Promise<T>): Promise<T> {
  const client = await pool().connect();

  try {
    const result = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS acquired",
      [SYNC_LOCK_ID],
    );
    if (!result.rows[0]?.acquired) {
      throw new Error("Sync already running");
    }

    try {
      return await work();
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [SYNC_LOCK_ID]);
    }
  } finally {
    client.release();
  }
}
