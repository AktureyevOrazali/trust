# Netlify Postgres AlphaCRM Dashboards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the existing Next.js dashboard on Netlify with Postgres-backed CRM synchronization, preserve the reviewed Google Sheets formulas exactly, and add Students and Groups dashboard tabs sourced from AlphaCRM.

**Architecture:** Netlify runs the standard Next.js App Router application. Netlify Database/Postgres stores current raw CRM records, sync runs, monthly plans, and daily analytics snapshots; scheduled functions trigger a protected background synchronization job. Platform-neutral repositories feed separate Sales, Students, and Groups APIs, while pure analytics modules reproduce spreadsheet formulas.

**Tech Stack:** Next.js 16.2.6, React 19.2.6, TypeScript 5.9.3, Netlify OpenNext runtime, Netlify Functions, Netlify Database/Postgres, Drizzle ORM 0.45.2, Node test runner.

## Global Constraints

- Google Sheets is a formula specification only; production rows come from AlphaCRM.
- Phase-one formulas must reproduce the reviewed workbook without corrections, including `E6:E1000` LTV range semantics and zero-on-missing-rate group expense.
- AlphaCRM and amoCRM are read-only integrations.
- Student phone, email, address, birth date, and notes must never reach dashboard DTOs.
- Preserve the user's existing uncommitted changes in `app/dashboard-client.tsx`, `app/globals.css`, and `app/layout.tsx`.
- Do not delete the remote Cloudflare deployment or D1 database; remove only repository/runtime dependencies after Netlify acceptance checks.
- Keep the existing Node.js floor `>=22.13.0`.
- Each task must pass its focused tests and build checkpoint before its commit.

---

## Target file structure

### Runtime and database

- `lib/runtime/env.ts`: validates and exposes server-only environment variables.
- `db/schema.ts`: Postgres tables and indexes.
- `db/index.ts`: Netlify Database Drizzle client.
- `db/sync-lock.ts`: one-session Postgres advisory lock for CRM synchronization.
- `db/repositories/integrations.ts`: raw records and sync-run persistence.
- `db/repositories/plans.ts`: monthly-plan persistence.
- `db/repositories/analytics.ts`: typed AlphaCRM reads and daily snapshots.
- `netlify/database/migrations/20260817120000_netlify_postgres_baseline.sql`: complete Postgres baseline migration applied by Netlify.

### Synchronization

- `lib/integrations/sync.ts`: platform-neutral sync orchestration.
- `netlify/functions/crm-sync-background.ts`: protected long-running sync worker.
- `netlify/functions/crm-sync-scheduled.ts`: hourly trigger.
- `app/api/integrations/sync/route.ts`: protected manual trigger returning 202.
- `scripts/import-monthly-plans.mjs`: stdin importer for existing D1 plans.

### Analytics and APIs

- `lib/analytics/types.ts`: normalized student, group, and DTO types.
- `lib/analytics/spreadsheet-parity.ts`: pure workbook-compatible calculations.
- `lib/analytics/alpha-normalize.ts`: converts AlphaCRM payloads into formula inputs.
- `lib/analytics/students.ts`: assembles Students dashboard data.
- `lib/analytics/groups.ts`: assembles Groups dashboard data.
- `app/api/students/route.ts`: Students DTO route.
- `app/api/groups/route.ts`: Groups DTO route.

### UI

- `app/dashboard/dashboard-shell.tsx`: tabs and shared source/freshness state.
- `app/dashboard/sales-dashboard.tsx`: existing sales presentation extracted without behavioral changes.
- `app/dashboard/students-dashboard.tsx`: student metrics and registry.
- `app/dashboard/groups-dashboard.tsx`: group metrics and tables.
- `app/dashboard-client.tsx`: compatibility entry that renders the shell.

### Tests

- `tests/runtime-portability.test.mjs`: rejects Cloudflare/vinext runtime dependencies.
- `tests/postgres-schema.test.mjs`: checks Postgres schema and repository contract.
- `tests/sync-service.test.ts`: sync authorization, locking, and failure preservation.
- `tests/spreadsheet-parity.test.ts`: exact workbook-formula fixtures.
- `tests/analytics-routes.test.mjs`: DTO boundaries and PII exclusion.
- `tests/rendered-html.test.mjs`: existing regressions plus tab presence.

---

### Task 1: Provision and connect Netlify Database

**Files:**
- Create: `netlify.toml`
- Modify: `.env.example`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: an authenticated Netlify CLI session and the current repository.
- Produces: a linked Netlify site, a managed Postgres database, and `NETLIFY_DB_URL` available to builds/functions/local Netlify development.

- [ ] **Step 1: Confirm Netlify CLI authentication and project linkage**

Run:

```powershell
npx netlify-cli status
```

Expected: the command identifies an authenticated Netlify account. If the repository is not linked, run `npx netlify-cli init`, choose “Create & configure a new site,” and keep the generated site linked to this repository.

- [ ] **Step 2: Provision Netlify Database**

Run:

```powershell
npx netlify-cli database init
```

Expected: Netlify reports a provisioned database and makes `NETLIFY_DB_URL` available to the linked site. Decline sample data because the project supplies its own migration.

- [ ] **Step 3: Add Netlify configuration**

Create `netlify.toml`:

```toml
[build]
  command = "npm run build"
  publish = ".next"

[functions]
  directory = "netlify/functions"

[functions."crm-sync-scheduled"]
  schedule = "@hourly"
```

Add to `.env.example`:

```dotenv
# Netlify Database / Postgres
NETLIFY_DB_URL=
URL=http://localhost:3000
```

Ensure `.netlify/` is ignored in `.gitignore` while `netlify.toml` remains tracked.

- [ ] **Step 4: Verify the linked database is reachable**

Run:

```powershell
npx netlify-cli dev --offline=false
```

Expected: Netlify Dev starts without a missing-database configuration error. Stop it after the readiness message.

- [ ] **Step 5: Commit the provisioning configuration**

```powershell
git add netlify.toml .env.example .gitignore
git commit -m "chore: configure Netlify database runtime"
```

---

### Task 2: Add the Postgres schema and repositories

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `drizzle.config.ts`
- Modify: `db/schema.ts`
- Modify: `db/index.ts`
- Create: `db/repositories/integrations.ts`
- Create: `db/repositories/plans.ts`
- Create: `db/repositories/analytics.ts`
- Create: `db/sync-lock.ts`
- Create: `netlify/database/migrations/20260817120000_netlify_postgres_baseline.sql`
- Create: `tests/postgres-schema.test.mjs`

**Interfaces:**
- Consumes: `NETLIFY_DB_URL` from Task 1 and `RawIntegrationRecord` from `lib/integrations/types.ts`.
- Produces: `db`, `IntegrationRepository`, `PlanRepository`, `AnalyticsRepository`, and `withSyncLock<T>(work: () => Promise<T>): Promise<T>`.

- [ ] **Step 1: Write the failing Postgres contract test**

Create `tests/postgres-schema.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("uses Postgres JSONB storage and no D1 adapter", async () => {
  const [schema, database, config] = await Promise.all([
    source("db/schema.ts"),
    source("db/index.ts"),
    source("drizzle.config.ts"),
  ]);
  assert.match(schema, /pgTable/);
  assert.match(schema, /jsonb\("payload"\)/);
  assert.match(schema, /analytics_daily_snapshots/);
  assert.match(database, /drizzle-orm\/netlify-db/);
  assert.doesNotMatch(database, /drizzle-orm\/d1/);
  assert.match(config, /dialect:\s*"postgresql"/);
});
```

- [ ] **Step 2: Run the test and verify the existing D1 implementation fails**

Run:

```powershell
node --test tests/postgres-schema.test.mjs
```

Expected: FAIL because `db/schema.ts` uses `sqliteTable` and `db/index.ts` uses `drizzle-orm/d1`.

- [ ] **Step 3: Install database dependencies**

Run:

```powershell
npm install @netlify/database pg
npm install --save-dev @types/pg
```

Keep the existing `drizzle-orm` and `drizzle-kit` versions unless their installed exports prove incompatible with `drizzle-orm/netlify-db`.

- [ ] **Step 4: Define the Postgres schema**

Replace `db/schema.ts` with tables using these exact names and primary/unique keys:

```ts
import { bigint, bigserial, index, integer, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";

export const integrationRecords = pgTable("integration_records", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  source: text("source").notNull(),
  scope: text("scope").notNull(),
  entityType: text("entity_type").notNull(),
  externalId: text("external_id").notNull(),
  payload: jsonb("payload").notNull(),
  sourceUpdatedAt: text("source_updated_at"),
  fetchedAt: bigint("fetched_at", { mode: "number" }).notNull(),
  syncRunId: text("sync_run_id").notNull(),
}, (table) => [
  uniqueIndex("uq_integration_record_source_scope_entity_external").on(table.source, table.scope, table.entityType, table.externalId),
  index("idx_integration_records_source_entity").on(table.source, table.entityType),
  index("idx_integration_records_fetched_at").on(table.fetchedAt),
]);

export const integrationSyncRuns = pgTable("integration_sync_runs", {
  id: text("id").primaryKey(),
  source: text("source").notNull(),
  status: text("status").notNull(),
  startedAt: bigint("started_at", { mode: "number" }).notNull(),
  completedAt: bigint("completed_at", { mode: "number" }),
  recordsSeen: integer("records_seen").notNull().default(0),
  recordsSaved: integer("records_saved").notNull().default(0),
  errorCount: integer("error_count").notNull().default(0),
  errors: jsonb("errors"),
});

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

export const analyticsDailySnapshots = pgTable("analytics_daily_snapshots", {
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
}, (table) => [
  uniqueIndex("uq_analytics_snapshot_date_branch").on(table.snapshotDate, table.branchId),
]);
```

- [ ] **Step 5: Add the database client and Drizzle configuration**

Implement `db/index.ts`:

```ts
import { drizzle } from "drizzle-orm/netlify-db";
import * as schema from "./schema";

export const db = drizzle({ schema });
export type Database = typeof db;
```

Set `drizzle.config.ts` to `dialect: "postgresql"`, `out: "./netlify/database/migrations"`, and `dbCredentials.url: process.env.NETLIFY_DB_URL ?? "postgres://postgres:postgres@localhost:5432/postgres"`.

- [ ] **Step 6: Implement repositories and lock**

Implement repository methods with these signatures:

```ts
export interface IntegrationRepository {
  startRun(source: "amo" | "alfa"): Promise<string>;
  saveRecords(runId: string, records: RawIntegrationRecord[]): Promise<number>;
  finishRun(runId: string, input: FinishSyncInput): Promise<void>;
  listPayloads(source: "amo" | "alfa", entityTypes: string[]): Promise<Array<{ entityType: string; payload: unknown; fetchedAt: number }>>;
  summary(): Promise<{ counts: EntityCount[]; runs: SyncRunSummary[] }>;
}

export interface PlanRepository {
  get(month: string): Promise<MonthlyPlan | null>;
  save(plan: MonthlyPlan): Promise<void>;
}

export async function withSyncLock<T>(work: () => Promise<T>): Promise<T>;
```

`withSyncLock` must reserve one `pg` client, execute `SELECT pg_try_advisory_lock(72667001) AS acquired`, throw `Sync already running` when false, and execute `SELECT pg_advisory_unlock(72667001)` in `finally` before releasing the client.

- [ ] **Step 7: Create and apply the Postgres migration**

Create `netlify/database/migrations/20260817120000_netlify_postgres_baseline.sql` with `CREATE TABLE` and `CREATE INDEX` statements matching `db/schema.ts`, then run:

```powershell
npx netlify-cli database migrations apply
```

Expected: the Postgres baseline creates all four tables and indexes, and Netlify reports the migration applied.

- [ ] **Step 8: Run focused tests and type-check through the build**

Run:

```powershell
node --test tests/postgres-schema.test.mjs
npm run build
```

Expected: the schema test passes. The build may still use vinext in this task, but must compile the new modules.

- [ ] **Step 9: Commit**

```powershell
git add package.json package-lock.json drizzle.config.ts db drizzle tests/postgres-schema.test.mjs
git commit -m "feat: add Netlify Postgres data layer"
```

---

### Task 3: Port the existing application runtime from Cloudflare to Netlify

**Files:**
- Create: `lib/runtime/env.ts`
- Create: `tests/runtime-portability.test.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `lib/dashboard/amo.ts`
- Modify: `lib/dashboard/alfa.ts`
- Modify: `lib/dashboard/plan.ts`
- Modify: `lib/integrations/storage.ts`
- Modify: `app/api/integrations/sync/route.ts`
- Modify: `app/api/integrations/summary/route.ts`
- Delete: `vite.config.ts`
- Delete: `worker/index.ts`
- Delete: `wrangler.jsonc`
- Delete: `.openai/hosting.json`
- Delete: `build/sites-vite-plugin.ts`
- Delete: `drizzle/0000_equal_mandroid.sql`
- Delete: `drizzle/0001_low_justin_hammer.sql`
- Delete: `drizzle/meta/_journal.json`
- Delete: `drizzle/meta/0000_snapshot.json`
- Delete: `drizzle/meta/0001_snapshot.json`

**Interfaces:**
- Consumes: Postgres repositories from Task 2.
- Produces: `serverEnv()`, a Cloudflare-free Next.js build, and existing Sales behavior backed by live APIs plus Postgres fallback.

- [ ] **Step 1: Write the failing portability test**

Create `tests/runtime-portability.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import test from "node:test";

test("has no Cloudflare or vinext runtime references", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  const files = execFileSync("rg", ["--files", "app", "lib", "db"], { encoding: "utf8" }).trim().split(/\r?\n/);
  const source = (await Promise.all(files.map((file) => readFile(file, "utf8")))).join("\n");
  assert.equal(packageJson.scripts.build, "next build");
  assert.equal(packageJson.scripts.dev, "next dev");
  assert.ok(!packageJson.dependencies?.vinext && !packageJson.devDependencies?.vinext);
  assert.doesNotMatch(source, /cloudflare:workers|D1Database/);
});
```

- [ ] **Step 2: Run it and verify failure**

Run `node --test tests/runtime-portability.test.mjs`.

Expected: FAIL on vinext scripts and `cloudflare:workers` imports.

- [ ] **Step 3: Add platform-neutral environment access**

Create `lib/runtime/env.ts`:

```ts
export interface ServerEnv {
  syncSecret?: string;
  amoBaseUrl?: string;
  amoAccessToken?: string;
  alfaBaseUrl?: string;
  alfaEmail?: string;
  alfaApiKey?: string;
  alfaBranchIds: string[];
  siteUrl: string;
}

export function serverEnv(): ServerEnv {
  return {
    syncSecret: process.env.SYNC_SECRET,
    amoBaseUrl: process.env.AMO_BASE_URL,
    amoAccessToken: process.env.AMO_ACCESS_TOKEN,
    alfaBaseUrl: process.env.ALFA_BASE_URL,
    alfaEmail: process.env.ALFA_EMAIL,
    alfaApiKey: process.env.ALFA_API_KEY,
    alfaBranchIds: (process.env.ALFA_BRANCH_IDS ?? "").split(",").map((value) => value.trim()).filter(Boolean),
    siteUrl: (process.env.URL ?? "http://localhost:3000").replace(/\/$/, ""),
  };
}
```

- [ ] **Step 4: Replace D1 access with repositories**

Refactor:

- `lib/dashboard/plan.ts` to call `PlanRepository.get/save` and preserve `INITIAL_PLAN` fallback;
- `lib/dashboard/amo.ts` and `lib/dashboard/alfa.ts` stored-data paths to call `IntegrationRepository.listPayloads`;
- `lib/integrations/storage.ts` to re-export repository-backed operations temporarily for call-site compatibility;
- integration summary route to call `IntegrationRepository.summary()`;
- all runtime credential reads to use `serverEnv()`.

Do not change payment classification, KEV calculation, date range behavior, monthly plan values, or cached/live/stored status messages.

- [ ] **Step 5: Switch scripts and dependencies**

Change package scripts to:

```json
{
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "test": "npm run build && node --test tests/*.test.mjs",
  "db:generate": "drizzle-kit generate"
}
```

Remove `vinext`, `@cloudflare/vite-plugin`, and `wrangler`. Keep `next`, React, Tailwind, Drizzle, Netlify Database, and Netlify Functions dependencies.

- [ ] **Step 6: Remove Cloudflare-only files with exact-path checks**

Verify each target exists and is inside the repository, then remove only:

```text
vite.config.ts
worker/index.ts
wrangler.jsonc
.openai/hosting.json
build/sites-vite-plugin.ts
drizzle/0000_equal_mandroid.sql
drizzle/0001_low_justin_hammer.sql
drizzle/meta/_journal.json
drizzle/meta/0000_snapshot.json
drizzle/meta/0001_snapshot.json
```

Do not recursively delete `.openai`, `build`, `.wrangler`, or another broad directory in this step.

- [ ] **Step 7: Run portability, existing regressions, lint, and build**

```powershell
node --test tests/runtime-portability.test.mjs tests/rendered-html.test.mjs
npm run lint
npm run build
```

Expected: no Cloudflare/vinext references in application code, existing Sales tests pass, lint passes, and Netlify-compatible `next build` completes.

- [ ] **Step 8: Commit**

```powershell
git add package.json package-lock.json lib app db tests netlify.toml
git add -u -- vite.config.ts worker/index.ts wrangler.jsonc .openai/hosting.json build/sites-vite-plugin.ts drizzle/0000_equal_mandroid.sql drizzle/0001_low_justin_hammer.sql drizzle/meta/_journal.json drizzle/meta/0000_snapshot.json drizzle/meta/0001_snapshot.json
git commit -m "refactor: port dashboard runtime to Netlify"
```

---

### Task 4: Add protected scheduled and background CRM synchronization

**Files:**
- Create: `lib/integrations/sync.ts`
- Create: `netlify/functions/crm-sync-background.ts`
- Create: `netlify/functions/crm-sync-scheduled.ts`
- Modify: `app/api/integrations/sync/route.ts`
- Create: `tests/sync-service.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: `serverEnv`, `withSyncLock`, `IntegrationRepository`, `AmoClient`, and `AlfaClient`.
- Produces: `runSynchronization(source: "amo" | "alfa" | "all"): Promise<SyncSummary[]>` and `triggerBackgroundSync(source): Promise<void>`.

- [ ] **Step 1: Write failing sync-service tests**

Create fixtures that inject fake clients/repositories and assert:

```ts
test("records partial entity errors without deleting prior records", async () => {
  const result = await runSynchronizationWithDependencies("alfa", depsWithOneEntityError);
  assert.equal(result[0].status, "completed_with_errors");
  assert.equal(fakeRepository.deletedRecords, 0);
});

test("rejects a second synchronization while the lock is held", async () => {
  await assert.rejects(() => lockedRun(), /Sync already running/);
});
```

- [ ] **Step 2: Run and verify failure**

Run:

```powershell
node --experimental-strip-types --test tests/sync-service.test.ts
```

Expected: FAIL because the dependency-injected synchronization service does not exist.

- [ ] **Step 3: Install Netlify Functions types/runtime package**

Run:

```powershell
npm install @netlify/functions
```

- [ ] **Step 4: Extract synchronization orchestration**

Implement:

```ts
export async function runSynchronization(source: SyncSource = "all"): Promise<SyncSummary[]> {
  return withSyncLock(async () => runSynchronizationWithDependencies(source, productionSyncDependencies()));
}
```

Keep per-source run rows, pagination, rate limiting, error serialization, and `completed_with_errors` behavior. After a successful AlphaCRM run, call the analytics snapshot writer for the current date.

- [ ] **Step 5: Add the background function**

`crm-sync-background.ts` must validate `Authorization: Bearer ${SYNC_SECRET}`, parse `source` from the request URL, call `runSynchronization`, and export:

```ts
export const config = {
  background: true,
  path: "/api/internal/crm-sync-background",
};
```

- [ ] **Step 6: Add scheduled and manual triggers**

Both triggers call the background URL with the secret header:

```ts
export async function triggerBackgroundSync(source: "amo" | "alfa" | "all") {
  const env = serverEnv();
  const response = await fetch(`${env.siteUrl}/api/internal/crm-sync-background?source=${source}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.syncSecret ?? ""}` },
  });
  if (!response.ok && response.status !== 202) throw new Error(`Sync trigger HTTP ${response.status}`);
}
```

The scheduled function always requests `all`. The manual Next route validates the same secret, validates `source`, triggers the job, and returns HTTP 202 with `{ accepted: true, source }`.

- [ ] **Step 7: Run focused tests and build**

```powershell
node --experimental-strip-types --test tests/sync-service.test.ts
npm run build
```

Expected: tests and build pass; invoking manual sync returns immediately instead of waiting for all CRM pages.

- [ ] **Step 8: Commit**

```powershell
git add package.json package-lock.json lib/integrations app/api/integrations netlify/functions tests/sync-service.test.ts
git commit -m "feat: add Netlify CRM synchronization jobs"
```

---

### Task 5: Implement exact spreadsheet-parity analytics

**Files:**
- Create: `lib/analytics/types.ts`
- Create: `lib/analytics/spreadsheet-parity.ts`
- Create: `tests/spreadsheet-parity.test.ts`
- Create: `tests/fixtures/sheet-parity-students.json`
- Create: `tests/fixtures/sheet-parity-groups.json`

**Interfaces:**
- Consumes: normalized `StudentFormulaRow[]`, `GroupHours`, and `TeacherRate` inputs.
- Produces: `calculateStudentMetrics(rows)`, `calculateGroupMetrics(rows, hours, rates)`, and deterministic descending-LTV compatibility ordering.

- [ ] **Step 1: Define normalized formula types in the failing test**

Use these interfaces:

```ts
export interface StudentFormulaRow {
  id: string;
  name: string;
  attendedLessons: number;
  paymentCount: number;
  ltv: number;
  group: string;
  teacher: string;
  startDate: string | null;
  endDate: string | null;
  status: string;
  months: number;
  renewals: number | null;
  subscriptionAmount: number;
}

export interface StudentMetrics {
  total: number;
  active: number;
  frozen: number;
  finished: number;
  booking: number;
  activeShare: number;
  frozenShare: number;
  finishedShare: number;
  bookingShare: number;
  renewalRate: number;
  churnRate: number;
  averageLifetime: number;
  maximumLifetime: number;
  averageRenewals: number;
  maximumRenewals: number;
  averageLtv: number;
  maximumLtv: number;
}
```

- [ ] **Step 2: Write exact workbook fixture assertions**

The test must include at least six rows so the `E6:E1000` equivalent can be checked:

```ts
const rows = [216000, 180000, 165000, 150000, 140313, 135000].map((ltv, index) => ({
  id: String(index + 1), name: `Student ${index + 1}`, attendedLessons: 1,
  paymentCount: 1, ltv, group: index === 0 ? "ИНД" : "G1", teacher: "Teacher",
  startDate: "2026-01-01", endDate: index === 3 ? "2026-07-01" : null,
  status: index === 3 ? "Закончил" : "Активен", months: index + 1,
  renewals: index, subscriptionAmount: 30000,
}));

assert.equal(metrics.total, 6);
assert.equal(metrics.active, 5);
assert.equal(metrics.maximumLtv, 150000);
assert.equal(metrics.churnRate, 1 - metrics.renewalRate);
```

Add a group fixture asserting `ИНД` is excluded, current active subscriptions are summed, expense is `hours * rate`, missing rate yields zero, and profit is revenue minus expense.

Create sanitized workbook fixtures by replacing student names with `Student 001`, `Student 002`, and so on while preserving row order, numeric fields, statuses, group codes, teacher labels, and dates. The fixture must contain no phone, email, address, birth date, or notes.

- [ ] **Step 3: Run and verify failure**

```powershell
node --experimental-strip-types --test tests/spreadsheet-parity.test.ts
```

Expected: FAIL because the analytics module does not exist.

- [ ] **Step 4: Implement minimal pure formulas**

Implement exact helpers:

```ts
const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

export function rowRenewals(months: number): number | null {
  return months <= 0 ? null : months - 1;
}

export function calculateStudentMetrics(input: StudentFormulaRow[], today = new Date()): StudentMetrics {
  const rows = [...input].sort((a, b) => b.ltv - a.ltv || a.name.localeCompare(b.name, "ru"));
  const renewals = rows.flatMap((row) => row.renewals == null ? [] : [row.renewals]);
  const finishedOpportunities = rows.filter((row) => row.status === "Закончил" && row.months > 0 && row.endDate && new Date(`${row.endDate}T12:00:00Z`) <= today).length;
  const renewalSum = renewals.reduce((sum, value) => sum + value, 0);
  const renewalRate = renewalSum + finishedOpportunities ? renewalSum / (renewalSum + finishedOpportunities) : 0;
  const ltvCompatibilityRange = rows.slice(3);
  return {
    total: rows.length,
    active: rows.filter((row) => row.status === "Активен").length,
    frozen: rows.filter((row) => row.status === "Заморозка").length,
    finished: rows.filter((row) => row.status === "Закончил").length,
    booking: rows.filter((row) => row.status === "Бронь").length,
    activeShare: rows.length ? rows.filter((row) => row.status === "Активен").length / rows.length : 0,
    frozenShare: rows.length ? rows.filter((row) => row.status === "Заморозка").length / rows.length : 0,
    finishedShare: rows.length ? rows.filter((row) => row.status === "Закончил").length / rows.length : 0,
    bookingShare: rows.length ? rows.filter((row) => row.status === "Бронь").length / rows.length : 0,
    renewalRate,
    churnRate: 1 - renewalRate,
    averageLifetime: average(rows.filter((row) => row.months > 0).map((row) => row.months)),
    maximumLifetime: Math.max(0, ...rows.map((row) => row.months)),
    averageRenewals: average(renewals),
    maximumRenewals: Math.max(0, ...renewals),
    averageLtv: average(ltvCompatibilityRange.map((row) => row.ltv)),
    maximumLtv: Math.max(0, ...ltvCompatibilityRange.map((row) => row.ltv)),
  };
}
```

Do not add corrected cohort rules, Other-status balancing, payment-based renewals, group payment allocation, lesson commission, or margin.

- [ ] **Step 5: Run tests**

```powershell
node --experimental-strip-types --test tests/spreadsheet-parity.test.ts
```

Expected: all workbook-parity fixtures pass.

- [ ] **Step 6: Commit**

```powershell
git add lib/analytics tests/spreadsheet-parity.test.ts tests/fixtures/sheet-parity-students.json tests/fixtures/sheet-parity-groups.json
git commit -m "feat: encode spreadsheet analytics formulas"
```

---

### Task 6: Normalize AlphaCRM records and expose Students/Groups APIs

**Files:**
- Create: `lib/analytics/alpha-normalize.ts`
- Create: `lib/analytics/students.ts`
- Create: `lib/analytics/groups.ts`
- Create: `app/api/students/route.ts`
- Create: `app/api/groups/route.ts`
- Create: `tests/analytics-routes.test.mjs`
- Modify: `db/repositories/analytics.ts`

**Interfaces:**
- Consumes: stored AlphaCRM entities and spreadsheet-parity functions.
- Produces: `getStudentsDashboard(filters): Promise<StudentsDashboardData>` and `getGroupsDashboard(filters): Promise<GroupsDashboardData>`.

- [ ] **Step 1: Write failing API boundary tests**

Create `tests/analytics-routes.test.mjs` that source-checks both routes and DTOs:

```js
test("student APIs expose analytics but no contact fields", async () => {
  const [students, groups, types] = await Promise.all([
    source("app/api/students/route.ts"),
    source("app/api/groups/route.ts"),
    source("lib/analytics/types.ts"),
  ]);
  assert.match(students, /getStudentsDashboard/);
  assert.match(groups, /getGroupsDashboard/);
  assert.doesNotMatch(types, /phone|email|addr|dob|note/);
});
```

- [ ] **Step 2: Run and verify failure**

Run `node --test tests/analytics-routes.test.mjs`.

Expected: FAIL because the routes and assemblers do not exist.

- [ ] **Step 3: Normalize AlphaCRM payloads**

Implement tolerant readers for entity IDs, number/string numeric values, ISO/Russian dates, arrays, lesson `details`, and missing optional fields. Join by IDs only:

```ts
export interface NormalizedAlphaData {
  students: StudentFormulaRow[];
  groupHours: Map<string, number>;
  teacherRates: Map<string, number>;
  freshness: { fetchedAt: number; status: "stored" | "stale" | "unavailable" };
  warnings: DataQualityWarning[];
}
```

Never join by student name. When one customer has multiple current groups, emit one registry display value but preserve every group membership for group aggregation.

- [ ] **Step 4: Assemble dashboard DTOs**

Students DTO contains metrics, six-month snapshots, risk rows, filter dictionaries, registry rows, warnings, and freshness. Groups DTO contains spreadsheet-parity group rows, aggregate averages/maxima, teacher rollups, warnings, and freshness.

Registry row types may contain only:

```ts
type StudentRegistryRow = Pick<StudentFormulaRow,
  "id" | "name" | "attendedLessons" | "paymentCount" | "ltv" | "group" |
  "teacher" | "startDate" | "endDate" | "status" | "months" | "renewals" |
  "subscriptionAmount"
> & { lessonBalance: number; activeTariff: string };
```

- [ ] **Step 5: Add routes with strict filters**

Validate `branch`, `teacher`, `group`, and `status` as trimmed strings no longer than 120 characters. Return `Cache-Control: no-store`. Invalid values return HTTP 400; unavailable Postgres returns HTTP 503 with a non-sensitive Russian error message.

- [ ] **Step 6: Run route tests, analytics tests, and build**

```powershell
node --test tests/analytics-routes.test.mjs
node --experimental-strip-types --test tests/spreadsheet-parity.test.ts
npm run build
```

Expected: DTO contract tests and parity tests pass; Next.js registers both API routes.

- [ ] **Step 7: Commit**

```powershell
git add lib/analytics db/repositories/analytics.ts app/api/students app/api/groups tests/analytics-routes.test.mjs
git commit -m "feat: expose AlphaCRM student and group analytics"
```

---

### Task 7: Add Students and Groups dashboard tabs

**Files:**
- Create: `app/dashboard/dashboard-shell.tsx`
- Create: `app/dashboard/sales-dashboard.tsx`
- Create: `app/dashboard/students-dashboard.tsx`
- Create: `app/dashboard/groups-dashboard.tsx`
- Modify: `app/dashboard-client.tsx`
- Modify: `app/globals.css`
- Modify: `tests/rendered-html.test.mjs`

**Interfaces:**
- Consumes: existing `DashboardData`, `/api/students`, and `/api/groups` DTOs.
- Produces: keyboard-accessible Sales, Students, and Groups tabs with lazy API loading and preserved Sales behavior.

- [ ] **Step 1: Preserve the user's existing UI changes before editing**

Run:

```powershell
git diff -- app/dashboard-client.tsx app/globals.css app/layout.tsx
```

Record the existing behavior in the task notes: current period controls, sales KPIs, observations, plan table, funnel, daily cash chart, manager table, payment registry, and layout metadata must remain.

- [ ] **Step 2: Extend the failing rendered-source test**

Add assertions:

```js
assert.match(shell, /role="tablist"/);
assert.match(shell, />Продажи</);
assert.match(shell, />Ученики</);
assert.match(shell, />Группы</);
assert.match(students, /Процент продления/);
assert.match(groups, /Валовая прибыль/);
```

Run `node --test tests/rendered-html.test.mjs` and expect failure because the tab components do not exist.

- [ ] **Step 3: Extract Sales without behavior changes**

Move the current Sales JSX and helper components into `sales-dashboard.tsx`. Keep the current prop contract:

```ts
export function SalesDashboard({ data, range, refreshing, onRefresh }: SalesDashboardProps) {}
```

Keep existing Russian copy, CSS class names, calculations, and fetch parameters intact.

- [ ] **Step 4: Implement the shell and lazy tab loading**

`dashboard-shell.tsx` owns `activeTab: "sales" | "students" | "groups"`. It fetches each non-sales DTO only on first activation, retains it in state, and exposes loading/error/retry states. Tab buttons use `role="tab"`, `aria-selected`, and matching `aria-controls`.

- [ ] **Step 5: Implement Students UI**

Render the exact spreadsheet labels and values:

- total, `Активные ученики`, `Заморозка`, `Неактивные`, `Бронь`;
- status percentages;
- `Процент продления`, `Процент оттока`;
- average/max lifetime and renewals;
- average/max LTV;
- six-month active trend;
- searchable registry and AlphaCRM-derived risk list.

Percentages display to one decimal place; counts use zero decimals; currency uses KZT formatting.

- [ ] **Step 6: Implement Groups UI**

Render group, teacher, student count, gross revenue, hours, expense, gross profit, comment/warning, teacher rollup, and revenue/profit rankings. Missing rate still produces zero expense for formula parity and also shows a warning badge.

- [ ] **Step 7: Add responsive styles without overwriting current edits**

Append focused `.dashboard-tabs`, `.student-*`, and `.group-*` selectors. Reuse existing color variables and table scroll patterns. Do not replace or reformat unrelated rules in `app/globals.css`.

- [ ] **Step 8: Run tests, lint, build, and visual checks**

```powershell
node --test tests/rendered-html.test.mjs tests/analytics-routes.test.mjs
npm run lint
npm run build
```

Start `npm run dev`, inspect desktop width 1440 and mobile width 390 in the browser, and verify tab navigation, no clipped KPI values, horizontally scrollable tables, readable filters, and unchanged Sales layout.

- [ ] **Step 9: Commit new UI modules and tests without taking ownership of pre-existing dirty hunks**

```powershell
git add app/dashboard tests/rendered-html.test.mjs
git commit -m "feat: add student and group dashboard tabs"
```

Leave `app/dashboard-client.tsx`, `app/globals.css`, and `app/layout.tsx` unstaged because they were already dirty before implementation. Report the required integration changes in the final handoff instead of committing pre-existing user hunks.

---

### Task 8: Migrate monthly plans, backfill CRM data, and verify cutover

**Files:**
- Create: `scripts/import-monthly-plans.mjs`
- Create: `tests/monthly-plan-import.test.mjs`
- Modify: `README.md`
- Modify: `.env.example`
- Remove if empty after exact-file removal: `worker/`

**Interfaces:**
- Consumes: remote D1 monthly-plan JSON, Netlify Postgres, CRM credentials, and the deployed background function.
- Produces: populated Postgres plans/records/snapshots and a verified Netlify deployment with no Cloudflare runtime dependency.

- [ ] **Step 1: Write the failing plan-import parser test**

Use a sanitized Wrangler JSON fixture and assert it maps snake-case D1 rows to `MonthlyPlan` without changing values. Run `node --test tests/monthly-plan-import.test.mjs` and expect failure.

- [ ] **Step 2: Implement stdin import**

`scripts/import-monthly-plans.mjs` reads stdin, accepts either Wrangler's top-level array or `{ results }`, validates integer nonnegative plan fields and `YYYY-MM` month, and upserts through Postgres. Invalid rows terminate with a nonzero exit and never partially apply.

- [ ] **Step 3: Export D1 plans directly into the importer**

Run before declaring cutover complete:

```powershell
npx wrangler@4.92.0 d1 execute rnp-dashboard --remote --command "SELECT month,new_leads,no_contact_percent,contact_percent,revenue,new_sales,repeat_revenue,updated_at FROM monthly_plans ORDER BY month" --json | node scripts/import-monthly-plans.mjs
```

Expected: importer reports the exact number of migrated months. If D1 has no rows, it reports zero and the existing `INITIAL_PLAN` fallback remains authoritative.

- [ ] **Step 4: Configure Netlify secrets**

Set `SYNC_SECRET`, `AMO_BASE_URL`, `AMO_ACCESS_TOKEN`, `ALFA_BASE_URL`, `ALFA_EMAIL`, `ALFA_API_KEY`, and optional `ALFA_BRANCH_IDS` in Netlify site environment variables. Mark credential values as secrets and make them available to Functions and Runtime scopes. Do not place values in repository files or command output.

- [ ] **Step 5: Deploy and run the initial backfill**

Run:

```powershell
npx netlify-cli deploy --build
npx netlify-cli deploy --build --prod
```

Then invoke the deployed background sync through the protected manual endpoint with `source=all`. Expected: HTTP 202 followed by completed amo and alfa sync-run rows in `/api/integrations/summary`.

- [ ] **Step 6: Reconcile formula outputs against sanitized workbook fixtures**

Run the formula engine against `tests/fixtures/sheet-parity-students.json` and `tests/fixtures/sheet-parity-groups.json` and compare these values with the reviewed workbook baseline:

```text
total=136
active=67
frozen=13
finished=11
booking=9
renewalRate=0.8431372549
churnRate=0.1568627451
averageLifetime=1.551282051
maximumLifetime=6
averageRenewals=0.5512820513
maximumRenewals=5
averageGroupRevenue=77739.13043
maximumGroupRevenue=240000
averageGrossProfit=74869.56522
maximumGrossProfit=240000
averageLtv=44428.29323
maximumLtv=150000
```

Any fixture mismatch blocks cutover and must be traced to fixture mapping or formula implementation, not resolved by changing the formulas. Current live AlphaCRM totals are allowed to differ from the historical workbook because AlphaCRM is the production source of current rows.

- [ ] **Step 7: Update operator documentation**

Document Netlify linkage, required environment variables, database migrations, local `netlify dev`, manual sync, scheduled sync, stale-data behavior, and rollback to the still-existing Cloudflare deployment. Remove Cloudflare deployment instructions from README.

- [ ] **Step 8: Run final verification**

```powershell
node --test tests/*.test.mjs
node --experimental-strip-types --test tests/*.test.ts
npm run lint
npm run build
rg -n "cloudflare:workers|D1Database|vinext|wrangler|@cloudflare" app lib db package.json netlify.toml
git diff --check
```

Expected: tests, lint, and build pass; the final `rg` command returns no matches; no formula parity mismatch; Netlify production shows all three tabs and current sync freshness.

- [ ] **Step 9: Commit documentation and migration tooling**

```powershell
git add scripts tests/monthly-plan-import.test.mjs README.md .env.example
git commit -m "docs: finalize Netlify analytics cutover"
```

---

## Final review checklist

- Existing Sales metrics and interactions are preserved.
- Postgres is the only application persistence layer.
- Background and scheduled jobs cannot overlap.
- A failed sync leaves prior records available and marks freshness stale.
- Student/group formulas match the workbook baseline exactly.
- No student contact fields leave the server.
- Cloudflare/vinext/D1 repository dependencies are gone.
- The remote Cloudflare deployment and D1 database remain untouched for rollback.
- Netlify production build, sync, Postgres migrations, desktop layout, and mobile layout are verified.
