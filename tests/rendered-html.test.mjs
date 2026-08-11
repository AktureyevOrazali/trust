import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("uses one validated date range across the dashboard", async () => {
  const [period, route, client] = await Promise.all([
    source("lib/dashboard/period.ts"),
    source("app/api/dashboard/route.ts"),
    source("app/dashboard-client.tsx"),
  ]);

  assert.match(period, /DashboardPeriod = "week" \| "month" \| "custom"/);
  assert.match(period, /MAX_RANGE_DAYS = 366/);
  assert.match(route, /search\.get\("from"\)/);
  assert.match(route, /search\.get\("to"\)/);
  assert.match(client, /type="date"/);
  assert.match(client, /className="dashboard-toolbar"/);
  assert.match(client, /aria-label="[^"]+"/);
});

test("counts stable amoCRM leads and historical KEV transitions", async () => {
  const amo = await source("lib/dashboard/amo.ts");

  assert.match(amo, /response\.status === 204/);
  assert.match(amo, /lead_status_changed/);
  assert.match(amo, /filter\[value_after\]\[leads_statuses\]/);
  assert.match(amo, /trend: buildTrend\(pipelineLeads, range\)/);
  assert.match(amo, /const kevCount = uniqueKevEvents\(kevEvents\)\.size/);
  assert.doesNotMatch(amo, /kevLeads/);
  assert.match(amo, /sourceStatus: "cached"/);
});

test("limits AlphaCRM load and exposes a compact daily chart", async () => {
  const [alfa, client] = await Promise.all([
    source("lib/dashboard/alfa.ts"),
    source("app/dashboard-client.tsx"),
  ]);

  assert.match(alfa, /created_at_from: alfaDate\(range\.from\)/);
  assert.match(alfa, /RequestRateLimiter\(220\)/);
  assert.match(alfa, /const rawCache = new Map/);
  assert.match(client, /data\.kevCount/);
  assert.match(client, /className="focus-stats"/);
  assert.doesNotMatch(client, /kevLeads/);
  assert.match(client, /className="cash-kpi-breakdown"/);
  assert.doesNotMatch(client, /Глубокая аналитика/);
  assert.doesNotMatch(client, /className="daily-scroll"/);
  assert.match(client, /className="combo-chart"/);
});
