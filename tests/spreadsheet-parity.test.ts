import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  calculateGroupMetrics,
  calculateStudentMetrics,
  rowRenewals,
} from "../lib/analytics/spreadsheet-parity.ts";
import type {
  GroupHours,
  StudentFormulaRow,
  TeacherRate,
} from "../lib/analytics/types.ts";

const students = JSON.parse(
  readFileSync(
    new URL("./fixtures/sheet-parity-students.json", import.meta.url),
    "utf8",
  ),
) as StudentFormulaRow[];
const groupFixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/sheet-parity-groups.json", import.meta.url),
    "utf8",
  ),
) as { hours: GroupHours[]; rates: TeacherRate[] };

function assertClose(actual: number, expected: number): void {
  assert.ok(
    Math.abs(actual - expected) < 1e-9,
    `expected ${actual} to equal ${expected}`,
  );
}

test("matches the workbook student metric formulas", () => {
  const metrics = calculateStudentMetrics(
    students,
    new Date("2026-08-18T12:00:00Z"),
  );

  assert.equal(metrics.total, 136);
  assert.equal(metrics.active, 67);
  assert.equal(metrics.frozen, 13);
  assert.equal(metrics.finished, 11);
  assert.equal(metrics.booking, 9);
  assertClose(metrics.renewalRate, 0.8431372549019608);
  assertClose(metrics.churnRate, 0.1568627450980392);
  assertClose(metrics.averageLifetime, 1.5512820512820513);
  assert.equal(metrics.maximumLifetime, 6);
  assertClose(metrics.averageRenewals, 0.5512820512820513);
  assert.equal(metrics.maximumRenewals, 5);
  assertClose(metrics.averageLtv, 44428.29323308271);
  assert.equal(metrics.maximumLtv, 150000);
});

test("keeps the workbook row renewal formula", () => {
  assert.equal(rowRenewals(0), null);
  assert.equal(rowRenewals(-1), null);
  assert.equal(rowRenewals(1), 0);
  assert.equal(rowRenewals(6), 5);
});

test("matches group revenue, expense, and missing-rate behavior", () => {
  const metrics = calculateGroupMetrics(
    students,
    groupFixture.hours,
    groupFixture.rates,
  );

  assert.equal(metrics.rows.length, 23);
  assert.equal(metrics.rows.some((row) => row.group === "ИНД"), false);
  assert.equal(metrics.rows.some((row) => row.group === "GuzChM17"), false);
  assert.deepEqual(
    metrics.rows.find((row) => row.group === "GuzChV33"),
    {
      group: "GuzChV33",
      teacher: "Teacher 002",
      studentCount: 3,
      revenue: 130000,
      hours: 12,
      expense: 36000,
      grossProfit: 94000,
      comment: "",
    },
  );
  assert.deepEqual(
    metrics.rows.find((row) => row.group === "бронь"),
    {
      group: "бронь",
      teacher: "",
      studentCount: 5,
      revenue: 0,
      hours: 0,
      expense: 0,
      grossProfit: 0,
      comment: "Ставка учителя не найдена",
    },
  );
  assertClose(metrics.averageRevenue, 77739.13043478261);
  assert.equal(metrics.maximumRevenue, 240000);
  assertClose(metrics.averageGrossProfit, 74869.56521739131);
  assert.equal(metrics.maximumGrossProfit, 240000);
});

test("workbook fixtures contain no contact fields or real student names", () => {
  for (const student of students) {
    assert.match(student.name, /^Student \d{3}$/);
    assert.match(student.teacher, /^(Teacher \d{3})?$/);
    assert.doesNotMatch(
      Object.keys(student).join(" "),
      /phone|email|address|birth|note/i,
    );
  }
});
