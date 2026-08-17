import assert from "node:assert/strict";
import test from "node:test";

import {
  runSynchronizationWithDependencies,
  type SynchronizationDependencies,
} from "../lib/integrations/sync.ts";
import type {
  FinishSyncInput,
  IntegrationRepository,
} from "../db/repositories/integrations.ts";
import type {
  DiscoveryResult,
  IntegrationSource,
  RawIntegrationRecord,
} from "../lib/integrations/types.ts";
import { buildAlphaDailySnapshots } from "../lib/analytics/alpha-snapshot.ts";

class FakeIntegrationRepository implements IntegrationRepository {
  deletedRecords = 0;
  finished: FinishSyncInput[] = [];
  saved: RawIntegrationRecord[] = [];
  started: IntegrationSource[] = [];

  async startRun(source: IntegrationSource): Promise<string> {
    this.started.push(source);
    return `${source}-run`;
  }

  async saveRecords(
    _runId: string,
    records: RawIntegrationRecord[],
  ): Promise<number> {
    this.saved.push(...records);
    return records.length;
  }

  async finishRun(_runId: string, input: FinishSyncInput): Promise<void> {
    this.finished.push(input);
  }

  async listPayloads() {
    return [];
  }

  async summary() {
    return { counts: [], runs: [] };
  }

  async deleteExistingRecords(): Promise<void> {
    this.deletedRecords += 1;
  }
}

function dependencies(
  repository: FakeIntegrationRepository,
  alfaDiscovery: () => Promise<DiscoveryResult>,
  lock: SynchronizationDependencies["withLock"] = async (work) => work(),
): SynchronizationDependencies {
  return {
    repository,
    withLock: lock,
    adapters: {
      alfa: { configured: true, missing: [], discover: alfaDiscovery },
      amo: {
        configured: false,
        missing: ["AMO_BASE_URL", "AMO_ACCESS_TOKEN"],
        discover: async () => ({ records: [], errors: [] }),
      },
    },
    writeAlphaSnapshot: async () => undefined,
  };
}

test("records partial entity errors without deleting prior records", async () => {
  const repository = new FakeIntegrationRepository();
  const record: RawIntegrationRecord = {
    source: "alfa",
    scope: "branch-1",
    entityType: "customer",
    externalId: "customer-1",
    payload: { id: 1, name: "Student 001" },
  };

  const result = await runSynchronizationWithDependencies(
    "alfa",
    dependencies(repository, async () => ({
      records: [record],
      errors: [
        {
          source: "alfa",
          scope: "branch-1",
          entityType: "lesson",
          message: "AlphaCRM lesson endpoint unavailable",
        },
      ],
    })),
  );

  assert.equal(result[0]?.status, "completed_with_errors");
  assert.equal(repository.deletedRecords, 0);
  assert.deepEqual(repository.saved, [record]);
  assert.equal(repository.finished[0]?.errors.length, 1);
});

test("rejects a second synchronization while the lock is held", async () => {
  const repository = new FakeIntegrationRepository();
  let locked = false;
  let releaseDiscovery!: () => void;
  const discoveryGate = new Promise<void>((resolve) => {
    releaseDiscovery = resolve;
  });
  const withLock: SynchronizationDependencies["withLock"] = async (work) => {
    if (locked) throw new Error("Sync already running");
    locked = true;
    try {
      return await work();
    } finally {
      locked = false;
    }
  };
  const deps = dependencies(repository, async () => {
    await discoveryGate;
    return { records: [], errors: [] };
  }, withLock);

  const firstRun = runSynchronizationWithDependencies("alfa", deps);
  await new Promise((resolve) => setImmediate(resolve));

  await assert.rejects(
    () => runSynchronizationWithDependencies("alfa", deps),
    /Sync already running/,
  );

  releaseDiscovery();
  await firstRun;
});

test("builds one current snapshot per AlphaCRM branch", () => {
  const snapshots = buildAlphaDailySnapshots(
    [
      {
        scope: "branch-1",
        entityType: "customer",
        externalId: "student-1",
        payload: { id: 1, is_study: true },
        fetchedAt: 1,
      },
      {
        scope: "branch-1",
        entityType: "customer",
        externalId: "student-2",
        payload: { id: 2, status_name: "Заморозка" },
        fetchedAt: 1,
      },
      {
        scope: "branch-1",
        entityType: "pay",
        externalId: "pay-1",
        payload: { id: 3, income: 45000, is_confirmed: true },
        fetchedAt: 1,
      },
      {
        scope: "branch-1",
        entityType: "group",
        externalId: "group-1",
        payload: { id: 4, is_active: true },
        fetchedAt: 1,
      },
    ],
    "2026-08-17",
    "alfa-run",
  );

  assert.deepEqual(snapshots, [
    {
      snapshotDate: "2026-08-17",
      branchId: "branch-1",
      totalStudents: 2,
      activeStudents: 1,
      frozenStudents: 1,
      finishedStudents: 0,
      bookingStudents: 0,
      revenue: 45000,
      paymentCount: 1,
      activeGroupCount: 1,
      syncRunId: "alfa-run",
    },
  ]);
});

test("persists a failed run when a requested source is not configured", async () => {
  const repository = new FakeIntegrationRepository();
  const deps = dependencies(repository, async () => ({ records: [], errors: [] }));

  const result = await runSynchronizationWithDependencies("amo", deps);

  assert.equal(result[0]?.status, "not_configured");
  assert.deepEqual(repository.started, ["amo"]);
  assert.equal(repository.finished[0]?.status, "failed");
  assert.equal(repository.finished[0]?.errors.length, 1);
});
