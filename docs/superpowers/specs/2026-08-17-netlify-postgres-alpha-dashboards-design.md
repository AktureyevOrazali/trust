# Netlify, Postgres, and AlphaCRM dashboards design

Date: 2026-08-17

## Objective

Move the application from the Cloudflare-specific vinext, Worker, Wrangler, and D1 runtime to standard Next.js on Netlify. Use managed Postgres as the system of record for synchronized CRM data and derived analytics. Preserve the existing sales dashboard, then add student and group dashboards whose operational data comes from AlphaCRM. The reviewed Google Sheets workbook defines the intended metrics but is not a production data source.

## Scope

The project will:

- run as a standard Next.js App Router application on Netlify;
- use Netlify Database/Postgres through Drizzle;
- read secrets through server-side environment variables;
- synchronize AlphaCRM and existing amoCRM data into Postgres;
- retain historical snapshots needed for trends;
- preserve the existing sales dashboard and monthly plans;
- add student overview, student registry, and group/teacher analytics;
- expose synchronization freshness and data-quality warnings;
- remove Cloudflare, vinext, Wrangler, Worker, Miniflare, D1 bindings, and Sites hosting configuration.

The project will not write changes back to AlphaCRM or amoCRM. It will not use Google Sheets after metric definitions have been implemented. It will not expose student contact details on dashboard pages.

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

Teacher-rate data is stored when it is returned by the tenant's teacher endpoint. Lesson-level commission is the preferred source for actual teacher cost.

### Application tables

`monthly_plans` retains the existing plan fields.

`analytics_daily_snapshots` stores one row per date and branch with total and status counts, revenue, payment count, active group count, and last successful sync ID. This table provides historical student trends that cannot be reconstructed reliably from only the current customer state.

No duplicate normalized copy of every CRM field will be introduced initially. Server-side query modules resolve raw JSONB records into typed domain objects. Focused aggregate tables may be added later only when measured query performance requires them.

## Metric definitions

### Student population and statuses

- A student is an AlphaCRM customer with `is_study = 1`.
- Archived customers are excluded from current counts and remain available for historical and churn calculations.
- Customer `study_status_id` is resolved through the `study_status` dictionary.
- Status names are normalized case-insensitively into Active, Frozen, Finished, Booking, and Other/Unspecified.
- All status cards reconcile to the total student count; unrecognized or blank statuses appear under Other/Unspecified.
- Status share equals status count divided by total students, with zero-safe handling.

### Attendance and lifetime

- Attended lessons are conducted lessons whose detail row for the customer has `is_attend = 1`.
- The student's study start is the earliest valid customer-tariff start date or group-membership start date.
- The study end is the latest completed tariff or membership end date for inactive students; active students use the dashboard as-of date.
- Lifetime months are the elapsed calendar months between study start and end/as-of date, with partial months represented as a decimal.

### Renewals and retention

- A renewal is a new customer-tariff period that begins after an earlier tariff period for the same student without a gap longer than 31 days.
- Renewal rate equals successful renewal opportunities divided by all completed tariff periods that reached an end date in the selected cohort window.
- Churn rate equals one minus renewal rate.
- Repeat-payment revenue remains a separate financial metric and is not used as the renewal event.

### Payments and LTV

- Only confirmed income payments are included.
- LTV is the sum of all confirmed income payments associated with a student.
- Payment count is the number of those payment records.
- Existing first-sale, repeat-sale, booking, payment-account, and payment-item classifications remain available on the sales dashboard.

### Group economics

- Current group size is the count of non-ended CGI memberships for students who are not archived.
- Group revenue is confirmed income whose payment record has the group ID and whose document date is inside the selected period.
- Payments without a group remain in overall revenue and appear in a data-quality warning; they are not allocated heuristically.
- Conducted hours are the sum of conducted lesson duration divided by 60 for lessons linked to the group and period.
- Teacher cost uses lesson-detail commission when present. If commission is absent, the configured teacher-rate rules are applied. A group without enough rate data is marked Unpriced instead of assuming zero cost.
- Gross profit equals group revenue minus priced teacher cost.
- Margin equals gross profit divided by group revenue, with zero-safe handling.

## Dashboard design

The existing page becomes a three-tab dashboard shell sharing period, branch, refresh, source-status, and data-freshness controls.

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

The registry contains searchable and filterable rows for name, status, group, teacher, study dates, attended lessons, payment count, LTV, active tariff, and lesson balance. Filters cover branch, teacher, group, status, and period. Contact details are omitted.

### Groups

The groups view contains:

- summary cards for active groups, students, revenue, priced teacher cost, gross profit, and margin;
- group table with teacher, active students, conducted hours, revenue, cost, profit, and margin;
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

- Unit tests cover date parsing, status normalization, renewal opportunities, churn, LTV, attendance, group revenue, teacher cost, and margin.
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
- Student status counts reconcile to the total, including Other/Unspecified.
- Renewal, churn, lifetime, attendance, payment count, and LTV follow the definitions above.
- Group revenue, hours, teacher cost, profit, and margin expose missing attribution instead of silently treating it as zero.
- Six-month student history is served from stored snapshots.
- Dashboard API responses contain no contact information or secrets.
- Build, automated tests, database checks, and responsive visual verification pass.
