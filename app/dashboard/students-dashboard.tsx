"use client";

import { useMemo, useState, type CSSProperties } from "react";
import type {
  AnalyticsFilters,
  StudentsDashboardData,
  StudentTrendPoint,
} from "@/lib/analytics/types";
import styles from "./dashboard.module.css";

const integer = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
const currency = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "KZT",
  currencyDisplay: "narrowSymbol",
  maximumFractionDigits: 0,
});

function percentage(value: number): string {
  return `${decimal.format(value * 100)}%`;
}

function dateLabel(value: string | null): string {
  if (!value) return "Нет данных";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));
}

function freshnessLabel(data: StudentsDashboardData): string {
  if (!data.freshness.fetchedAt) return "Данные AlphaCRM ещё не загружены";
  const date = new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(data.freshness.fetchedAt));
  return data.freshness.status === "stale"
    ? `Сохранённые данные устарели, обновлены ${date}`
    : `Сохранённые данные обновлены ${date}`;
}

function monthlyTrend(points: StudentTrendPoint[]): StudentTrendPoint[] {
  const months = new Map<string, StudentTrendPoint>();
  for (const point of points) months.set(point.date.slice(0, 7), point);
  return [...months.values()].sort((left, right) => left.date.localeCompare(right.date)).slice(-6);
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className={styles.filterField}>
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Все</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

export function StudentsDashboard({
  data,
  filters,
  refreshing,
  onFiltersChange,
}: {
  data: StudentsDashboardData;
  filters: AnalyticsFilters;
  refreshing: boolean;
  onFiltersChange: (filters: AnalyticsFilters) => void;
}) {
  const [search, setSearch] = useState("");
  const rows = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("ru");
    if (!needle) return data.rows;
    return data.rows.filter((row) =>
      [row.name, row.group, row.teacher, row.activeTariff]
        .some((value) => value.toLocaleLowerCase("ru").includes(needle)),
    );
  }, [data.rows, search]);
  const trend = monthlyTrend(data.trend);
  const maxActive = Math.max(1, ...trend.map((point) => point.active));
  const replaceFilter = (name: keyof AnalyticsFilters, value: string) => {
    onFiltersChange({ ...filters, [name]: value || undefined });
  };

  return (
    <main className={styles.analyticsShell} aria-busy={refreshing}>
      <header className={styles.analyticsHeader}>
        <div>
          <p>AlphaCRM и формулы Google Sheets</p>
          <h1>Ученики</h1>
          <span>{freshnessLabel(data)}</span>
        </div>
        <div className={styles.sourceState} data-state={data.freshness.status}>
          {data.freshness.status === "stored" ? "Данные актуальны" :
            data.freshness.status === "stale" ? "Требуется синхронизация" : "Нет данных"}
        </div>
      </header>

      <section className={styles.primaryMetrics} aria-label="Статусы учеников">
        <article><span>Всего учеников</span><strong>{integer.format(data.metrics.total)}</strong></article>
        <article><span>Активные ученики</span><strong>{integer.format(data.metrics.active)}</strong><small>{percentage(data.metrics.activeShare)}</small></article>
        <article><span>Заморозка</span><strong>{integer.format(data.metrics.frozen)}</strong><small>{percentage(data.metrics.frozenShare)}</small></article>
        <article><span>Неактивные</span><strong>{integer.format(data.metrics.finished)}</strong><small>{percentage(data.metrics.finishedShare)}</small></article>
        <article><span>Бронь</span><strong>{integer.format(data.metrics.booking)}</strong><small>{percentage(data.metrics.bookingShare)}</small></article>
      </section>

      <section className={styles.secondaryMetrics} aria-label="Показатели учеников">
        <article><span>Процент продления</span><strong>{percentage(data.metrics.renewalRate)}</strong></article>
        <article><span>Процент оттока</span><strong>{percentage(data.metrics.churnRate)}</strong></article>
        <article><span>Средний срок обучения</span><strong>{decimal.format(data.metrics.averageLifetime)} мес.</strong></article>
        <article><span>Максимальный срок</span><strong>{integer.format(data.metrics.maximumLifetime)} мес.</strong></article>
        <article><span>Среднее число продлений</span><strong>{decimal.format(data.metrics.averageRenewals)}</strong></article>
        <article><span>Максимум продлений</span><strong>{integer.format(data.metrics.maximumRenewals)}</strong></article>
        <article><span>Средний LTV</span><strong>{currency.format(data.metrics.averageLtv)}</strong></article>
        <article><span>Максимальный LTV</span><strong>{currency.format(data.metrics.maximumLtv)}</strong></article>
      </section>

      <section className={styles.insightGrid}>
        <article className={styles.panel}>
          <div className={styles.panelHeading}>
            <div><h2>Активные ученики за 6 месяцев</h2><p>Последний сохранённый срез каждого месяца</p></div>
          </div>
          {trend.length > 0 ? (
            <div className={styles.trendChart}>
              {trend.map((point) => (
                <div key={point.date}>
                  <strong>{integer.format(point.active)}</strong>
                  <i style={{ "--bar-size": `${Math.max(8, point.active / maxActive * 100)}%` } as CSSProperties} />
                  <span>{new Intl.DateTimeFormat("ru-RU", { month: "short", timeZone: "UTC" }).format(new Date(`${point.date}T12:00:00Z`))}</span>
                </div>
              ))}
            </div>
          ) : <p className={styles.emptyState}>История появится после ежедневных синхронизаций AlphaCRM.</p>}
        </article>

        <article className={`${styles.panel} ${styles.riskPanel}`}>
          <div className={styles.panelHeading}>
            <div><h2>Требуют внимания</h2><p>Абонементы, посещения и баланс занятий</p></div>
            <strong>{data.risks.length}</strong>
          </div>
          {data.risks.length > 0 ? (
            <div className={styles.riskList}>
              {data.risks.slice(0, 8).map((risk) => (
                <div key={risk.id}>
                  <span><strong>{risk.name}</strong><small>{risk.group || "Группа не указана"}</small></span>
                  <p>{risk.reasons.join(", ")}</p>
                </div>
              ))}
            </div>
          ) : <p className={styles.emptyState}>По текущим данным рисков не найдено.</p>}
        </article>
      </section>

      <section className={styles.panel} id="student-registry">
        <div className={styles.registryHeading}>
          <div><h2>Реестр учеников</h2><p>{integer.format(rows.length)} строк после фильтров</p></div>
          <div className={styles.filters}>
            <label className={`${styles.filterField} ${styles.searchField}`}>
              <span>Поиск</span>
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Имя, группа, преподаватель" />
            </label>
            <FilterSelect
              label="Филиал"
              value={filters.branch ?? ""}
              options={data.filters.branches}
              onChange={(value) => replaceFilter("branch", value)}
            />
            <FilterSelect
              label="Преподаватель"
              value={filters.teacher ?? ""}
              options={data.filters.teachers.map((value) => ({ value, label: value }))}
              onChange={(value) => replaceFilter("teacher", value)}
            />
            <FilterSelect
              label="Группа"
              value={filters.group ?? ""}
              options={data.filters.groups.map((value) => ({ value, label: value }))}
              onChange={(value) => replaceFilter("group", value)}
            />
            <FilterSelect
              label="Статус"
              value={filters.status ?? ""}
              options={data.filters.statuses.map((value) => ({ value, label: value }))}
              onChange={(value) => replaceFilter("status", value)}
            />
          </div>
        </div>
        <div className={styles.tableScroll}>
          <table className={styles.dataTable}>
            <thead><tr><th>Ученик</th><th>Статус</th><th>Группа</th><th>Преподаватель</th><th>Период обучения</th><th>Посещения</th><th>Оплаты</th><th>LTV</th><th>Абонемент</th><th>Остаток</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td><strong>{row.name}</strong></td>
                  <td><span className={styles.statusBadge} data-status={row.status}>{row.status || "Не указан"}</span></td>
                  <td>{row.group || "Не указана"}</td>
                  <td>{row.teacher || "Не указан"}</td>
                  <td>{dateLabel(row.startDate)}<small>{row.endDate ? `по ${dateLabel(row.endDate)}` : "без даты окончания"}</small></td>
                  <td>{integer.format(row.attendedLessons)}</td>
                  <td>{integer.format(row.paymentCount)}</td>
                  <td><strong>{currency.format(row.ltv)}</strong></td>
                  <td>{row.activeTariff || "Не указан"}<small>{currency.format(row.subscriptionAmount)}</small></td>
                  <td>{integer.format(row.lessonBalance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <p className={styles.emptyState}>По выбранным условиям учеников нет.</p>}
        </div>
      </section>

      {data.warnings.length > 0 && (
        <aside className={styles.warningStrip} aria-label="Предупреждения о данных">
          <strong>Качество данных</strong>
          {data.warnings.map((warning) => (
            <span key={warning.code}>{warning.message}: {integer.format(warning.count)}</span>
          ))}
        </aside>
      )}
    </main>
  );
}
