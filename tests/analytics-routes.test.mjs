import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workspace = new URL("../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, workspace), "utf8");
}

test("student and group routes expose the analytics assemblers", async () => {
  const [students, groups] = await Promise.all([
    source("app/api/students/route.ts"),
    source("app/api/groups/route.ts"),
  ]);

  assert.match(students, /getStudentsDashboard/);
  assert.match(groups, /getGroupsDashboard/);
  assert.match(students, /Cache-Control["']?:\s*["']no-store/);
  assert.match(groups, /Cache-Control["']?:\s*["']no-store/);
});

test("analytics DTOs do not define private contact fields", async () => {
  const types = await source("lib/analytics/types.ts");

  assert.doesNotMatch(types, /\b(phone|email|address|addr|dob|birth|note)s?\b/i);
});

test("routes validate public filters and hide storage errors", async () => {
  const [students, groups] = await Promise.all([
    source("app/api/students/route.ts"),
    source("app/api/groups/route.ts"),
  ]);

  for (const route of [students, groups]) {
    assert.match(route, /parseAnalyticsFilters/);
    assert.match(route, /status:\s*503/);
    assert.doesNotMatch(route, /error instanceof Error \? error\.message/);
  }
});
