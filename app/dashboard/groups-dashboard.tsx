"use client";

import type { AnalyticsFilters, GroupsDashboardData } from "@/lib/analytics/types";
import styles from "./dashboard.module.css";

const integer = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
const currency = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "KZT",
  currencyDisplay: "narrowSymbol",
  maximumFractionDigits: 0,
});

function freshnessLabel(data: GroupsDashboardData): string {
  if (!data.freshness.fetchedAt) return "Данные AlphaCRM ещё не загружены";
  const date = new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(data.freshness.fetchedAt));
  return data.freshness.status === "stale"
    ? `Сохранённые данные устарели, обновлены ${date}`
    : `Сохранённые данные обновлены ${date}`;
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

export function GroupsDashboard({
  data,
  filters,
  refreshing,
  onFiltersChange,
}: {
  data: GroupsDashboardData;
  filters: AnalyticsFilters;
  refreshing: boolean;
  onFiltersChange: (filters: AnalyticsFilters) => void;
}) {
  const rows = data.metrics.rows;
  const totals = rows.reduce(
    (result, row) => ({
      students: result.students + row.studentCount,
      revenue: result.revenue + row.revenue,
      expense: result.expense + row.expense,
      profit: result.profit + row.grossProfit,
    }),
    { students: 0, revenue: 0, expense: 0, profit: 0 },
  );
  const revenueRanking = [...rows].sort((left, right) => right.revenue - left.revenue).slice(0, 5);
  const profitRanking = [...rows].sort((left, right) => right.grossProfit - left.grossProfit).slice(0, 5);
  const replaceFilter = (name: keyof AnalyticsFilters, value: string) => {
    onFiltersChange({ ...filters, [name]: value || undefined });
  };

  return (
    <main className={styles.analyticsShell} aria-busy={refreshing}>
      <header className={styles.analyticsHeader}>
        <div>
          <p>AlphaCRM и формулы Google Sheets</p>
          <h1>Группы</h1>
          <span>{freshnessLabel(data)}</span>
        </div>
        <div className={styles.sourceState} data-state={data.freshness.status}>
          {data.freshness.status === "stored" ? "Данные актуальны" :
            data.freshness.status === "stale" ? "Требуется синхронизация" : "Нет данных"}
        </div>
      </header>

      <section className={styles.primaryMetrics} aria-label="Экономика групп">
        <article><span>Группы</span><strong>{integer.format(rows.length)}</strong></article>
        <article><span>Ученики в группах</span><strong>{integer.format(totals.students)}</strong></article>
        <article><span>Выручка</span><strong>{currency.format(totals.revenue)}</strong></article>
        <article><span>Расходы на преподавателей</span><strong>{currency.format(totals.expense)}</strong></article>
        <article><span>Валовая прибыль</span><strong>{currency.format(totals.profit)}</strong></article>
      </section>

      <section className={styles.secondaryMetrics} aria-label="Средние и максимальные показатели">
        <article><span>Средняя выручка группы</span><strong>{currency.format(data.metrics.averageRevenue)}</strong></article>
        <article><span>Максимальная выручка</span><strong>{currency.format(data.metrics.maximumRevenue)}</strong></article>
        <article><span>Средняя валовая прибыль</span><strong>{currency.format(data.metrics.averageGrossProfit)}</strong></article>
        <article><span>Максимальная валовая прибыль</span><strong>{currency.format(data.metrics.maximumGrossProfit)}</strong></article>
      </section>

      <section className={styles.panel}>
        <div className={styles.registryHeading}>
          <div><h2>Экономика по группам</h2><p>Выручка и расходы рассчитаны по формулам исходной таблицы</p></div>
          <div className={styles.filters}>
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
              label="Статус ученика"
              value={filters.status ?? ""}
              options={data.filters.statuses.map((value) => ({ value, label: value }))}
              onChange={(value) => replaceFilter("status", value)}
            />
          </div>
        </div>
        <div className={styles.tableScroll}>
          <table className={styles.dataTable}>
            <thead><tr><th>Группа</th><th>Преподаватель</th><th>Ученики</th><th>Проведено часов</th><th>Выручка</th><th>Расход</th><th>Валовая прибыль</th><th>Проверка данных</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.group}>
                  <td><strong>{row.group}</strong></td>
                  <td>{row.teacher || "Не указан"}</td>
                  <td>{integer.format(row.studentCount)}</td>
                  <td>{decimal.format(row.hours)}</td>
                  <td>{currency.format(row.revenue)}</td>
                  <td>{currency.format(row.expense)}</td>
                  <td><strong>{currency.format(row.grossProfit)}</strong></td>
                  <td>{row.comment
                    ? <span className={styles.warningBadge}>{row.comment}</span>
                    : <span className={styles.okBadge}>Проверено</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <p className={styles.emptyState}>По выбранным условиям групп нет.</p>}
        </div>
      </section>

      <section className={styles.insightGrid}>
        <article className={styles.panel}>
          <div className={styles.panelHeading}><div><h2>Рейтинг групп</h2><p>Выручка и валовая прибыль</p></div></div>
          <div className={styles.rankingColumns}>
            <div><h3>По выручке</h3>{revenueRanking.map((row, index) => <p key={row.group}><span>{index + 1}. {row.group}</span><strong>{currency.format(row.revenue)}</strong></p>)}</div>
            <div><h3>По прибыли</h3>{profitRanking.map((row, index) => <p key={row.group}><span>{index + 1}. {row.group}</span><strong>{currency.format(row.grossProfit)}</strong></p>)}</div>
          </div>
          {rows.length === 0 && <p className={styles.emptyState}>Рейтинг появится после синхронизации.</p>}
        </article>

        <article className={styles.panel}>
          <div className={styles.panelHeading}><div><h2>Сводка по преподавателям</h2><p>Группы, часы и экономика</p></div></div>
          <div className={styles.teacherList}>
            {data.teacherRollups.map((teacher) => (
              <div key={teacher.teacher}>
                <span><strong>{teacher.teacher}</strong><small>{teacher.groups} гр., {teacher.students} уч., {decimal.format(teacher.hours)} ч.</small></span>
                <p><small>Выручка {currency.format(teacher.revenue)}</small><strong>{currency.format(teacher.grossProfit)}</strong></p>
              </div>
            ))}
          </div>
          {data.teacherRollups.length === 0 && <p className={styles.emptyState}>Сводка появится после синхронизации.</p>}
        </article>
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
