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
  assert.match(period, /Период не может быть длиннее/);
  assert.match(route, /search\.get\("from"\)/);
  assert.match(route, /search\.get\("to"\)/);
  assert.match(client, /type="date"/);
  assert.match(client, /Один период для amoCRM, AlphaCRM, КЭВ и всех графиков/);
});

test("counts stable amoCRM leads and historical KEV transitions", async () => {
  const amo = await source("lib/dashboard/amo.ts");

  assert.match(amo, /response\.status === 204/);
  assert.match(amo, /lead_status_changed/);
  assert.match(amo, /filter\[value_after\]\[leads_statuses\]/);
  assert.match(amo, /trend: buildTrend\(pipelineLeads, range, currentUnsorted\)/);
  assert.match(amo, /kevCount: kevLeads\.length/);
  assert.match(amo, /sourceStatus: "cached"/);
});

test("limits AlphaCRM load and exposes analytical views", async () => {
  const [alfa, client] = await Promise.all([
    source("lib/dashboard/alfa.ts"),
    source("app/dashboard-client.tsx"),
  ]);

  assert.match(alfa, /created_at_from: alfaDate\(range\.from\)/);
  assert.match(alfa, /RequestRateLimiter\(220\)/);
  assert.match(alfa, /const rawCache = new Map/);
  assert.match(client, /Все лиды, прошедшие через КЭВ/);
  assert.match(client, /Экономика и ритм потока/);
  assert.match(client, /className="combo-chart"/);
});
