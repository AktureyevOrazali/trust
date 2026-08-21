# Netlify, Postgres, and AlphaCRM dashboards design

Date: 2026-08-17

## Objective

Move the application from the Cloudflare-specific vinext, Worker, Wrangler, and D1 runtime to standard Next.js on Netlify. Use managed Postgres as the system of record for synchronized CRM data and derived analytics. Preserve the existing sales dashboard, then add student and group dashboards whose operational data comes from AlphaCRM. The reviewed Google Sheets workbook defines the phase-one formulas exactly but is not a production data source.

## Scope

The project will:

- run as a standard Next.js App Router application on Netlify;
- use Netlify Database/Postgres through Drizzle;
- read secrets through server-side environment variables;
- synchronize AlphaCRM and existing amoCRM data into Postgres;
- retain historical snapshots needed for trends;
- preserve the existing sales dashboard and monthly plans;
- reproduce the Google Sheets formulas without correcting or redefining them in this phase;
- add student overview, student registry, and group/teacher analytics;
- expose synchronization freshness and data-quality warnings;
- remove Cloudflare, vinext, Wrangler, Worker, Miniflare, D1 bindings, and Sites hosting configuration.

The project will not write changes back to AlphaCRM or amoCRM. It will not use Google Sheets after its formulas have been encoded and parity-tested. It will not expose student contact details on dashboard pages. Formula improvements, corrected cohort logic, and alternative definitions are explicitly deferred to a future approved phase.

## Chosen architecture

```text
AlphaCRM API ─┐
              ├─> Netlify background sync ─> Postgres raw records
amoCRM API ───┘                                  │
                                                ├─> normalized views and aggregates
Netlify scheduled function ─> sync trigger      │
                                                └─> Next.js route handlers ─> dashboards
```

### Web runtime

- Next.js remains the application framework.
- Standard `next dev`, `next build`, and `next start` scripts replace vinext commands.
- Netlify's maintained OpenNext adapter supplies SSR, App Router route handlers, caching, and image optimization automatically.
- A small runtime configuration module owns access to `process.env`. Business modules do not import platform-specific environment objects.

### Database

- Netlify Database supplies managed Postgres.
- Drizzle remains the schema and query layer, but tables move from `sqlite-core` to `pg-core`.
- Database access is isolated in `db/` so dashboard calculations do not depend on Netlify APIs directly.
- Postgres becomes the only persisted application database after cutover.

### Synchronization

- A scheduled Netlify Function starts synchronization on an hourly schedule.
- The scheduled function performs only orchestration and invokes a background function because a complete CRM sync can exceed the scheduled-function execution limit.
- A protected manual endpoint starts the same background job when an authorized operator presses Refresh.
- A database advisory lock prevents overlapping sync runs.
- API requests retain pagination, retry, authentication refresh, and rate limiting.
- Sync runs record start time, completion time, record counts, errors, and source freshness.
- A failed sync never deletes the last successful dataset. Dashboards continue to show stored data with a stale-data warning.

## Data model

### Integration storage

`integration_records` stores one current raw record per source, branch, entity type, and external ID. JSONB preserves the complete API payload.

`integration_sync_runs` stores execution status and diagnostics.

The required AlphaCRM entity set is:

- branch;
- customer;
- study_status;
- group;
- group_customer (CGI membership);
- lesson;
- pay;
- pay_account;
- pay_item;
- tariff;
- customer_tariff;
- teacher;
- subject.

Teacher-rate data is stored when it is returned by the tenant's teacher endpoint. Phase one uses the spreadsheet formula `hours * hourly rate`; lesson-level commission is retained only as source data for a possible future formula revision.

### Application tables

`monthly_plans` retains the existing plan fields.

`analytics_daily_snapshots` stores one row per date and branch with total and status counts, revenue, payment count, active group count, and last successful sync ID. This table provides historical student trends that cannot be reconstructed reliably from only the current customer state.

No duplicate normalized copy of every CRM field will be introduced initially. Server-side query modules resolve raw JSONB records into typed domain objects. Focused aggregate tables may be added later only when measured query performance requires them.

## Spreadsheet-parity metric definitions

Phase one treats the Google Sheets calculations as the compatibility contract. AlphaCRM replaces manually entered source rows, but aggregation formulas and their current range semantics remain unchanged. Known weaknesses are documented but not corrected.

### Student source columns

- A student row corresponds to an AlphaCRM customer with `is_study = 1`.
- Name comes from `customer.name`.
- Attended lessons are counted from conducted lesson details with `is_attend = 1`.
- Payment count and LTV are derived from the student's confirmed income payments.
- Group and teacher are resolved from CGI membership, group, and teacher data.
- Start and end dates use the student's AlphaCRM tariff/membership dates.
- Status is the AlphaCRM study-status name and is compared to the exact sheet labels Active (`Активен`), Frozen (`Заморозка`), Finished (`Закончил`), and Booking (`Бронь`).
- Study months reproduce `Кол-во мес` as the number of full calendar months from the AlphaCRM customer `created_at` date through today.
- Renewals reproduce the row formula `IF(months <= 0, blank, months - 1)`.
- Subscription amount comes from the applicable AlphaCRM tariff price.

### Student totals and status analytics

- Total students reproduces `COUNTA(student names)`.
- Active, Frozen, Finished, and Booking counts reproduce `COUNTIF(status, label)` independently.
- Each displayed status percentage is its status count divided by total students.
- No balancing Other/Unspecified percentage is added in phase one because it is not part of the source sheet formulas.

### Renewal, churn, and lifetime analytics

- Renewal percentage reproduces `SUM(renewals) / (SUM(renewals) + finished students whose end date is on or before today and whose months are greater than zero)`, returning zero on error.
- Churn percentage reproduces `100% - renewal percentage`.
- Average lifetime reproduces the average of positive `Кол-во мес` values.
- Maximum lifetime reproduces the maximum `Кол-во мес` value.
- Average renewals reproduces the average of the renewal column, including its blank/zero behavior.
- Maximum renewals reproduces the maximum of the renewal column.
- Repeat-payment revenue remains a separate sales metric and does not replace the spreadsheet renewal formula.

### LTV analytics

- Per-student LTV is the sum of confirmed income payments associated with that student.
- Payment count is the count of those payment records.
- Average and maximum LTV preserve the sheet's current `E6:E1000` range semantics. The compatibility dataset therefore uses the same descending-LTV row order and begins the aggregate at the equivalent of sheet row 6.
- The intentional parity rule above is not corrected to include the first three student rows in phase one.

### Group analytics

- The group list reproduces the unique nonblank group names from student rows, excluding only the exact value `ИНД`.
- The displayed teacher reproduces the first matching student's teacher for the group.
- Student count reproduces `COUNTIF(student group, group name)`.
- Group gross revenue reproduces the sum of current subscription amounts for students in the group whose status is exactly `Активен`.
- Group hours come from conducted AlphaCRM lesson duration for that group.
- Group expense reproduces `hours * teacher hourly rate`, returning zero when the rate lookup fails, as in the sheet.
- Gross profit reproduces `group gross revenue - group expense`.
- Average and maximum group revenue reproduce `AVERAGE` and `MAX` over the group revenue column.
- Average and maximum gross profit reproduce `AVERAGE` and `MAX` over the gross-profit column.
- Average profit per group remains the same duplicate average of the gross-profit column used in the sheet.

Any future change to these definitions requires a separate specification, a reconciliation report against the phase-one baseline, and explicit approval.

## Dashboard design

The existing page becomes a three-tab dashboard shell sharing branch, refresh, source-status, and data-freshness controls. The Sales tab keeps its period selector. Student and group spreadsheet-parity cards use their current-snapshot inputs; only explicitly historical charts use a time range.

### Sales

The existing result-of-sales dashboard remains functionally intact. It continues to combine amoCRM lead data with AlphaCRM payment data and monthly plans.

### Students

The overview contains:

- total students and status cards;
- status distribution;
- renewal rate and churn rate;
- average and maximum lifetime;
- average renewals;
- average and maximum LTV;
- six-month active-student trend;
- risk list for expiring tariffs, no recent attendance, or depleted lesson balance.

The registry contains searchable and filterable rows for name, status, group, teacher, study dates, attended lessons, payment count, LTV, active tariff, and lesson balance. Filters cover branch, teacher, group, and status. Contact details are omitted.

### Groups

The groups view contains:

- summary cards for groups, students, spreadsheet-formula revenue, teacher expense, and gross profit;
- group table with teacher, students, conducted hours, revenue, expense, and gross profit;
- rankings by revenue and profit;
- teacher rollup;
- warnings for missing teacher, missing rate, payments without group, and groups with no active membership.

## API boundaries

- Integration clients return raw external records and know nothing about UI metrics.
- Repositories read and write Postgres records.
- Domain analytics modules compute students, renewals, LTV, attendance, and group economics.
- Route handlers validate period/filter inputs and return typed dashboard DTOs.
- React components render DTOs and do not classify CRM payloads directly.

This separation allows CRM payload mapping, metric definitions, database implementation, and UI presentation to be tested independently.

## Error handling and security

- AlphaCRM and amoCRM credentials exist only in Netlify server-side environment variables.
- `SYNC_SECRET` protects manual synchronization.
- API responses and logs never include credentials or full CRM payloads.
- Student phone, email, address, birth date, and notes are not returned to dashboard clients.
- Failed authentication, throttling, malformed records, and partial entity failures are captured per sync run.
- Dashboard responses include source state: live, stored, stale, or unavailable.
- Empty and partially synchronized datasets render explicit messages rather than misleading zero metrics.

## Migration sequence

1. Convert build and runtime configuration to standard Next.js.
2. Add platform-neutral environment access.
3. Provision Netlify Database and add the Postgres Drizzle schema and migrations.
4. Move repositories and monthly plans from D1 calls to Postgres.
5. Move CRM synchronization storage and status endpoints to Postgres.
6. Add scheduled/background Netlify synchronization entry points.
7. Backfill Postgres from fresh AlphaCRM and amoCRM synchronization. Copy current monthly plans from D1 before removing the D1 deployment dependency.
8. Refactor dashboard calculations into platform-neutral domain modules.
9. Preserve and verify the Sales tab.
10. Add Students and Groups tabs.
11. Verify production-like Netlify build, database migrations, sync behavior, and responsive rendering.
12. Remove vinext, Cloudflare, Wrangler, Worker, D1, Miniflare, Sites configuration, and unused generated artifacts.

Cutover does not delete the existing Cloudflare deployment or D1 database. They remain a rollback source until the Netlify deployment has passed acceptance checks; removal from the repository only eliminates runtime dependency.

## Testing strategy

- Unit tests cover date parsing, exact status labels, spreadsheet renewal/churn formulas, row-compatible LTV ranges, attendance, group revenue, teacher expense, and gross profit.
- Repository tests run against a local Postgres database and verify upserts, JSONB payloads, advisory locking, snapshots, and monthly plans.
- Integration-client tests use representative sanitized AlphaCRM and amoCRM fixtures for pagination, retries, and partial failures.
- Route tests verify input validation, no PII leakage, stale status, and empty states.
- Existing rendered-page tests remain and are extended for Students and Groups tabs.
- A production-like build must pass with `next build`.
- A smoke sync must populate required entity types and produce reconciling status totals before Netlify cutover.

## Acceptance criteria

- No application file imports `cloudflare:workers` or uses `D1Database`.
- No runtime or build dependency on vinext, Wrangler, Cloudflare plugins, Workers, Miniflare, or Sites remains.
- Netlify builds the application as standard Next.js.
- Postgres migrations create all required tables and the application connects through server-only configuration.
- Scheduled and manual synchronization cannot overlap and preserve the last successful data on failure.
- Sales metrics remain consistent with the current dashboard for the same period.
- Student and group metrics reconcile to the values produced by the reviewed Google Sheets formulas for the same normalized input rows.
- No phase-one metric silently substitutes a corrected cohort, retention, LTV, group-revenue, or group-expense definition.
- Renewal, churn, lifetime, attendance, payment count, and LTV follow the spreadsheet-parity definitions above.
- Group revenue, hours, teacher expense, and gross profit follow the spreadsheet-parity definitions above, including zero-on-missing-rate behavior.
- Six-month student history is served from stored snapshots.
- Dashboard API responses contain no contact information or secrets.
- Build, automated tests, database checks, and responsive visual verification pass.
