import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeAlphaRecords,
  type StoredAlphaRecord,
} from "../lib/analytics/alpha-normalize.ts";
import { calculateGroupMetrics } from "../lib/analytics/spreadsheet-parity.ts";

const fetchedAt = Date.parse("2026-08-18T08:00:00Z");

function record(
  entityType: string,
  externalId: string,
  payload: Record<string, unknown>,
  scope = "b1",
): StoredAlphaRecord {
  return { scope, entityType, externalId, payload, fetchedAt };
}

const records: StoredAlphaRecord[] = [
  record("branch", "b1", { id: "b1", name: "Центр" }, "account"),
  record("study_status", "s1", { id: "s1", name: "Активен" }),
  record("study_status", "s2", { id: "s2", name: "Заморозка" }),
  record("teacher", "t1", { id: "t1", name: "Учитель 1", hour_rate: "2500" }),
  record("teacher", "t2", { id: "t2", name: "Учитель 2", rate: { value: 3000 } }),
  record("group", "g1", { id: "g1", name: "Группа 1", teacher_ids: ["t1"] }),
  record("group", "g2", { id: "g2", name: "Группа 2", teacher_id: "t2" }),
  record("tariff", "tr1", { id: "tr1", name: "Стандарт", price: "30 000" }),
  record("customer", "c1", {
    id: "c1",
    name: "Одинаковое имя",
    is_study: 1,
    study_status_id: "s1",
    phone: "+70000000000",
  }),
  record("customer", "c2", {
    id: "c2",
    name: "Одинаковое имя",
    is_study: "1",
    study_status_id: "s2",
  }),
  record("customer", "lead", { id: "lead", name: "Лид", is_study: 0 }),
  record("group_customer", "m1", {
    id: "m1",
    customer_id: "c1",
    group_id: "g1",
    date_from: "01.04.2026",
    date_to: "01.09.2026",
  }),
  record("group_customer", "m2", {
    id: "m2",
    customer_id: "c1",
    group_id: "g2",
  }),
  record("group_customer", "m3", {
    id: "m3",
    customer_id: "c2",
    group_id: "g1",
  }),
  record("customer_tariff", "ct1", {
    id: "ct1",
    customer_id: "c1",
    tariff_id: "tr1",
    date_from: "01.04.2026",
    date_to: "01.09.2026",
    lessons_left: 2,
  }),
  record("pay", "p1", { id: "p1", customer_id: "c1", income: "100 000", is_confirmed: 1 }),
  record("pay", "p2", { id: "p2", customer_id: "c1", income: 50_000, is_confirmed: 0 }),
  record("pay", "p3", { id: "p3", customer_id: "c2", income: 200_000 }),
  record("lesson", "l1", {
    id: "l1",
    status: 3,
    date: "2026-08-17",
    time_from: "10:00",
    time_to: "11:30",
    group_ids: ["g1"],
    details: [
      { customer_id: "c1", is_attend: 1 },
      { customer_id: "c2", is_attend: 0 },
    ],
  }),
  record("lesson", "l2", {
    id: "l2",
    status: "Проведено",
    date: "17.08.2026",
    duration_minutes: 60,
    group_id: "g2",
    details: [{ customer_id: "c1", is_attend: true }],
  }),
];

test("normalizes AlphaCRM records using IDs and exact spreadsheet inputs", () => {
  const normalized = normalizeAlphaRecords(records, new Date("2026-08-18T12:00:00Z"));

  assert.equal(normalized.students.length, 2);
  assert.equal(normalized.groupStudents.length, 3);
  const first = normalized.students.find((student) => student.id === "b1:c1");
  const second = normalized.students.find((student) => student.id === "b1:c2");
  assert.ok(first);
  assert.ok(second);
  assert.deepEqual(first.groups, ["Группа 1", "Группа 2"]);
  assert.equal(first.teacher, "Учитель 1");
  assert.equal(first.status, "Активен");
  assert.equal(first.attendedLessons, 2);
  assert.equal(first.paymentCount, 1);
  assert.equal(first.ltv, 100_000);
  assert.equal(first.subscriptionAmount, 30_000);
  assert.equal(first.months, 5);
  assert.equal(first.renewals, 4);
  assert.equal(first.activeTariff, "Стандарт");
  assert.equal(first.lessonBalance, 2);
  assert.equal(second.status, "Заморозка");
  assert.equal(second.ltv, 200_000);
  assert.equal(second.attendedLessons, 0);
  assert.equal(normalized.groupHours.get("Группа 1"), 1.5);
  assert.equal(normalized.groupHours.get("Группа 2"), 1);
  assert.equal(normalized.teacherRates.get("Учитель 1"), 2500);
  assert.equal(normalized.teacherRates.get("Учитель 2"), 3000);
  assert.equal(normalized.freshness.status, "stored");
  assert.doesNotMatch(JSON.stringify(normalized.students), /\+70000000000/);
});

test("preserves the workbook group formula behavior after normalization", () => {
  const normalized = normalizeAlphaRecords(records, new Date("2026-08-18T12:00:00Z"));
  const metrics = calculateGroupMetrics(
    normalized.groupStudents,
    [...normalized.groupHours].map(([group, hours]) => ({ group, hours })),
    [...normalized.teacherRates].map(([teacher, rate]) => ({ teacher, rate })),
  );

  assert.deepEqual(metrics.rows.map((row) => row.group), ["Группа 2"]);
  assert.equal(metrics.rows[0].studentCount, 1);
  assert.equal(metrics.rows[0].revenue, 30_000);
  assert.equal(metrics.rows[0].expense, 3000);
  assert.equal(metrics.rows[0].grossProfit, 27_000);
});
