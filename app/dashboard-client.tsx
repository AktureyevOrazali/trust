"use client";

import {
  useCallback,
  useEffect,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import type {
  DashboardData,
  DashboardPeriod,
  DashboardRange,
} from "@/lib/dashboard";
import type { MonthlyPlan, MonthlyPlanInput } from "@/lib/dashboard/plan";

const nf = new Intl.NumberFormat("ru-RU");
const STAGE_COLORS = [
  "#ea5b4d",
  "#f08a4b",
  "#e6b447",
  "#91b86d",
  "#4d9b78",
  "#2f7d68",
  "#266051",
  "#173f39",
];

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function findStage(stages: DashboardData["stages"], fragment: string): number {
  return (
    stages.find((stage) =>
      stage.name.toLocaleLowerCase("ru").includes(fragment.toLocaleLowerCase("ru")),
    )?.count ?? 0
  );
}

function percent(value: number, total: number) {
  if (!total) return "0%";
  return `${Math.round((value / total) * 100)}%`;
}

function rangeLabel(range: DashboardRange) {
  const format = (value: string, withYear: boolean) =>
    new Intl.DateTimeFormat("ru-RU", {
      day: "2-digit",
      month: "short",
      ...(withYear ? { year: "numeric" } : {}),
      timeZone: "UTC",
    }).format(new Date(`${value}T12:00:00Z`));
  const sameYear = range.from.slice(0, 4) === range.to.slice(0, 4);
  return `${format(range.from, !sameYear)} — ${format(range.to, true)}`;
}

function saleTypeClass(saleType: string) {
  if (saleType === "Первая") return "first-sale";
  if (saleType === "Повторная") return "repeat-sale";
  if (saleType === "Бронь") return "booking-sale";
  return "unknown-sale";
}

function articleGroup(category: string) {
  const normalized = category.toLocaleLowerCase("ru");
  if (normalized.includes("перв китай")) return "first";
  if (normalized.includes("повт китай")) return "repeat";
  if (normalized.includes("бронь")) return "booking";
  return "other";
}

function KpiCard({
  label,
  value,
  tone = "light",
}: {
  label: string;
  value: string | number;
  tone?: "light" | "jade" | "amber" | "coral" | "blue" | "gray";
}) {
  return (
    <article className={`kpi-card kpi-${tone}`}>
      <p>{label}</p>
      <strong>{value}</strong>
    </article>
  );
}

type PlanField = keyof MonthlyPlanInput;

function planValue(field: PlanField, value: number) {
  if (field === "revenue" || field === "repeatRevenue") return `${nf.format(value)} ₸`;
  if (field === "noContactPercent" || field === "contactPercent") return `${value}%`;
  return nf.format(value);
}

function PlanRow({
  field, label, fact, plan, isLimit = false, editing, onChange,
}: {
  field: PlanField;
  label: string;
  fact: number;
  plan: MonthlyPlanInput;
  isLimit?: boolean;
  editing: boolean;
  onChange: (field: PlanField, value: number) => void;
}) {
  const target = plan[field];
  const completion = isLimit
    ? fact <= target ? 100 : Math.round((target / Math.max(fact, 1)) * 100)
    : Math.round((fact / Math.max(target, 1)) * 100);
  const status = isLimit ? (fact <= target ? "в норме" : "выше лимита") : `${completion}%`;

  return (
    <div className="plan-row">
      <strong>{label}</strong>
      <span className="plan-fact">{planValue(field, fact)}</span>
      {editing ? (
        <input aria-label={`План: ${label}`} min="0" type="number" value={target} onChange={(event) => onChange(field, Number(event.target.value))} />
      ) : (
        <span className="plan-target">{isLimit ? `≤ ${planValue(field, target)}` : planValue(field, target)}</span>
      )}
      <span className={`plan-status ${isLimit && fact > target ? "behind" : ""}`}>{status}</span>
      <div className="plan-progress" aria-label={`Выполнение: ${status}`}>
        <i style={{ "--plan-width": `${Math.min(100, completion)}%` } as CSSProperties} />
      </div>
    </div>
  );
}

export function DashboardClient({
  data: initialData,
}: {
  data: DashboardData;
}) {
  const [data, setData] = useState(initialData);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [appliedRange, setAppliedRange] = useState(initialData.range);
  const [customFrom, setCustomFrom] = useState(initialData.range.from);
  const [customTo, setCustomTo] = useState(initialData.range.to);
  const [isCustomRangeOpen, setIsCustomRangeOpen] = useState(
    initialData.range.period === "custom",
  );
  const [filterError, setFilterError] = useState("");
  const [isPlanEditing, setIsPlanEditing] = useState(false);
  const [isSavingPlan, setIsSavingPlan] = useState(false);
  const [planError, setPlanError] = useState("");
  const [planDraft, setPlanDraft] = useState<MonthlyPlanInput>({
    newLeads: initialData.plan.newLeads,
    noContactPercent: initialData.plan.noContactPercent,
    contactPercent: initialData.plan.contactPercent,
    revenue: initialData.plan.revenue,
    newSales: initialData.plan.newSales,
    repeatRevenue: initialData.plan.repeatRevenue,
  });

  const refresh = useCallback(async (
    requestedRange: Pick<DashboardRange, "period"> & Partial<DashboardRange>,
    force = false,
  ) => {
    setIsRefreshing(true);
    setFilterError("");
    try {
      const search = new URLSearchParams({ period: requestedRange.period });
      if (requestedRange.from) search.set("from", requestedRange.from);
      if (requestedRange.to) search.set("to", requestedRange.to);
      if (force) search.set("force", "1");
      const response = await fetch(`/api/dashboard?${search.toString()}`, {
        cache: "no-store",
      });
      const result = (await response.json()) as DashboardData & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Не удалось применить период");
      setData(result);
      setAppliedRange(result.range);
      setCustomFrom(result.range.from);
      setCustomTo(result.range.to);
    } catch (error) {
      setFilterError(error instanceof Error ? error.message : "Не удалось обновить данные");
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const interval = window.setInterval(
      () => void refresh(appliedRange),
      120_000,
    );
    return () => window.clearInterval(interval);
  }, [appliedRange, refresh]);

  const pipelineStages = data.stages.filter(
    (stage) => !stage.name.toLocaleLowerCase("ru").includes("неразобран"),
  );
  const stages = data.unsorted
    ? [{ id: -1, name: "Неразобранные заявки", count: data.unsorted, amount: 0, sort: -1 }, ...pipelineStages]
    : pipelineStages;

  const missed = findStage(stages, "недоз");
  const contact = findStage(stages, "контакт");
  const booked = findStage(stages, "записан");
  const trial = findStage(data.stages, "кэв");
  const funnelTotal = stages.reduce((sum, stage) => sum + stage.count, 0);
  const todayIndex = data.trend.findIndex((day) => day.isToday);
  const monthTitle = new Intl.DateTimeFormat("ru-RU", {
    month: "long",
    year: "numeric",
  }).format(new Date());

  const dailyRows = data.trend.map((leadDay, index) => {
    const alphaDay = data.alfa.daily.find((day) => day.dateKey === leadDay.date);
    return {
      dateKey: leadDay.date,
      date: leadDay.label,
      newLeads: leadDay.value,
      cash: alphaDay?.firstChineseCash ?? 0,
      repeatCash: alphaDay?.repeatChineseCash ?? 0,
      bookingCash: alphaDay?.bookingCash ?? 0,
      payments: alphaDay?.payments ?? 0,
      kev: data.kevByDate[leadDay.date] ?? 0,
      isToday: leadDay.isToday,
      isFuture: todayIndex >= 0 && index > todayIndex,
    };
  });
  const newLeads = data.trend.reduce((sum, day) => sum + day.value, 0);
  const firstChineseSales = data.alfa.sales.filter((sale) => articleGroup(sale.category) === "first");
  const repeatChineseSales = data.alfa.sales.filter((sale) => articleGroup(sale.category) === "repeat");
  const bookingSales = data.alfa.sales.filter((sale) => articleGroup(sale.category) === "booking");
  const unspecifiedSales = data.alfa.sales.filter((sale) => articleGroup(sale.category) === "other");
  const firstSales = firstChineseSales.length;
  const repeatSales = repeatChineseSales.length;
  const cash = firstChineseSales.reduce((sum, sale) => sum + sale.amount, 0);
  const repeatCash = repeatChineseSales.reduce((sum, sale) => sum + sale.amount, 0);
  const bookingCash = bookingSales.reduce((sum, sale) => sum + sale.amount, 0);
  const unspecifiedCash = unspecifiedSales.reduce((sum, sale) => sum + sale.amount, 0);
  const averageCheck = firstSales ? Math.round(cash / firstSales) : 0;
  const periodLabel = rangeLabel(appliedRange);
  const leadToSale = percent(firstSales, newLeads);
  const noContactPercent = newLeads ? Math.round((missed / newLeads) * 100) : 0;
  const contactPercent = newLeads ? Math.round((contact / newLeads) * 100) : 0;
  const selectPeriod = (nextPeriod: Exclude<DashboardPeriod, "custom">) => {
    setIsCustomRangeOpen(false);
    if (nextPeriod === appliedRange.period && !isRefreshing) return;
    void refresh({ period: nextPeriod });
  };
  const openCustomPeriod = () => {
    setIsCustomRangeOpen(true);
  };
  const applyCustomPeriod = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void refresh({ period: "custom", from: customFrom, to: customTo });
  };
  const updatePlanDraft = (field: PlanField, value: number) => {
    setPlanDraft((current) => ({ ...current, [field]: Number.isFinite(value) ? Math.max(0, value) : 0 }));
  };
  const startPlanEditing = () => {
    setPlanError("");
    setPlanDraft({
      newLeads: data.plan.newLeads,
      noContactPercent: data.plan.noContactPercent,
      contactPercent: data.plan.contactPercent,
      revenue: data.plan.revenue,
      newSales: data.plan.newSales,
      repeatRevenue: data.plan.repeatRevenue,
    });
    setIsPlanEditing(true);
  };
  const savePlan = async () => {
    setIsSavingPlan(true);
    setPlanError("");
    try {
      const response = await fetch("/api/plan", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(planDraft),
      });
      const result = (await response.json()) as { plan?: MonthlyPlan; error?: string };
      if (!response.ok || !result.plan) throw new Error(result.error ?? "Не удалось сохранить план");
      setData((current) => ({ ...current, plan: result.plan! }));
      setIsPlanEditing(false);
    } catch (error) {
      setPlanError(error instanceof Error ? error.message : "Не удалось сохранить план");
    } finally {
      setIsSavingPlan(false);
    }
  };

  return (
    <main className="rnp-shell">
      <header className="rnp-header">
        <a className="rnp-brand" href="#overview">
          <span className="rnp-mark">中</span>
          <span>
            <strong>РНП</strong>
          </span>
        </a>

        <div className="header-statuses">
          <span
            className={`sync-pill ${data.connected ? "online" : ""} ${data.sourceStatus !== "live" ? "stale" : ""}`}
            title={data.statusMessage}
          >
            <i /> amoCRM
          </span>
          <span
            className={`sync-pill ${data.alfa.connected ? "online" : ""} ${data.alfa.sourceStatus !== "live" ? "stale" : ""}`}
            title={data.alfa.statusMessage}
          >
            <i /> AlfaCRM
          </span>
          <button
            className={`refresh-control ${isRefreshing ? "spinning" : ""}`}
            type="button"
            onClick={() => void refresh(appliedRange, true)}
            disabled={isRefreshing}
            aria-label="Обновить данные"
          >
            <span>↻</span>
            Обновить
          </button>
        </div>
      </header>

      <section className="overview-bar" id="overview">
        <div>
          <h1>Результат продаж</h1>
        </div>
        <div className="dashboard-toolbar" aria-label="Фильтр даты">
          <div className="toolbar-period">
            <strong>{periodLabel}</strong>
          </div>
          <div className="toolbar-controls">
            <div className="period-switcher" role="group" aria-label="Быстрый выбор периода">
              <button type="button" className={appliedRange.period === "week" && !isCustomRangeOpen ? "active" : ""} onClick={() => selectPeriod("week")}>Неделя</button>
              <button type="button" className={appliedRange.period === "month" && !isCustomRangeOpen ? "active" : ""} onClick={() => selectPeriod("month")}>Этот месяц</button>
              <button type="button" className={isCustomRangeOpen ? "active" : ""} onClick={openCustomPeriod}>Свои даты</button>
            </div>
            {isCustomRangeOpen && (
              <form className="date-range-form" onSubmit={applyCustomPeriod}>
                <label><span>С</span><input type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} required /></label>
                <label><span>По</span><input type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} required /></label>
                <button type="submit" disabled={isRefreshing}>Применить</button>
              </form>
            )}
            {filterError && <small className="filter-error">{filterError}</small>}
          </div>
        </div>
      </section>

      <section className="executive-kpis" aria-label="Ключевые показатели">
        <KpiCard
          label="Новые лиды"
          value={nf.format(newLeads)}
          tone="coral"
        />
        <KpiCard label="Новые продажи" value={nf.format(firstSales)} tone="jade" />
        <KpiCard label="Новые · касса" value={nf.format(cash) + " ₸"} tone="jade" />
        <KpiCard label="Повторные · касса" value={nf.format(repeatCash) + " ₸"} tone="amber" />
        <KpiCard label="Бронь · касса" value={nf.format(bookingCash) + " ₸"} tone="blue" />
        <KpiCard label="Не определено" value={nf.format(unspecifiedCash) + " ₸"} tone="gray" />
        <KpiCard label="Новые продажи / лиды" value={leadToSale} tone="light" />
        <KpiCard label="Средний чек" value={nf.format(averageCheck) + " ₸"} tone="light" />
      </section>

      <section className="plan-panel" aria-label="План месяца">
        <div className="plan-heading">
          <div>
            <h2>{monthTitle.charAt(0).toUpperCase() + monthTitle.slice(1)}</h2>
          </div>
          {appliedRange.period === "month" && (
            <div className="plan-actions">
              {isPlanEditing ? (
                <>
                  <button type="button" className="plan-cancel" onClick={() => setIsPlanEditing(false)}>Отмена</button>
                  <button type="button" className="plan-save" onClick={() => void savePlan()} disabled={isSavingPlan}>
                    {isSavingPlan ? "Сохранение…" : "Сохранить план"}
                  </button>
                </>
              ) : (
                <button type="button" className="plan-edit" onClick={startPlanEditing}>Изменить план</button>
              )}
            </div>
          )}
        </div>

        {appliedRange.period === "month" ? (
          <>
            <div className="plan-head"><span>Показатель</span><span>Факт</span><span>План</span><span>Выполнение</span><span /></div>
            <div className="plan-list">
              <PlanRow field="newLeads" label="Новые лиды" fact={newLeads} plan={planDraft} editing={isPlanEditing} onChange={updatePlanDraft} />
              <PlanRow field="noContactPercent" label="Недозвоны" fact={noContactPercent} plan={planDraft} isLimit editing={isPlanEditing} onChange={updatePlanDraft} />
              <PlanRow field="contactPercent" label="Контакт" fact={contactPercent} plan={planDraft} editing={isPlanEditing} onChange={updatePlanDraft} />
              <PlanRow field="revenue" label="Касса" fact={cash} plan={planDraft} editing={isPlanEditing} onChange={updatePlanDraft} />
              <PlanRow field="newSales" label="Перв Китайский" fact={firstSales} plan={planDraft} editing={isPlanEditing} onChange={updatePlanDraft} />
              <PlanRow field="repeatRevenue" label="Повт Китайский · касса" fact={repeatCash} plan={planDraft} editing={isPlanEditing} onChange={updatePlanDraft} />
            </div>
            {planError && <p className="plan-error">{planError}</p>}
          </>
        ) : null}
      </section>

      <section className="executive-grid">
        <article className="section-panel funnel-panel">
          <div className="section-heading">
            <div>
              <h2>Распределение лидов по этапам</h2>
            </div>
            <p>{funnelTotal} лидов за период</p>
          </div>
          <div className="funnel-list">
            {stages.map((stage, index) => {
              const maxCount = Math.max(...stages.map((item) => item.count), 1);
              return (
                <div className="funnel-item funnel-item-detailed" key={stage.id}>
                  <span className="funnel-index">{String(index + 1).padStart(2, "0")}</span>
                  <span className="funnel-name">{stage.name}</span>
                  <div className="funnel-bar">
                    <i
                      style={
                        {
                          "--bar-color": STAGE_COLORS[index % STAGE_COLORS.length],
                          "--bar-width": `${Math.max(4, (stage.count / maxCount) * 100)}%`,
                        } as CSSProperties
                      }
                    />
                  </div>
                  <strong>{stage.count}</strong>
                  <span className="funnel-rate">{percent(stage.count, newLeads)}</span>
                </div>
              );
            })}
          </div>
        </article>

        <article className="section-panel focus-panel">
          <div className="focus-heading">
            <h2>Приоритет команды</h2>
          </div>
          <div className="focus-main">
            <span>Без качественного контакта</span>
            <strong>{missed}</strong>
            <p>лидов требуют обработки</p>
          </div>
          <div className="focus-progress" aria-label={`${percent(missed, newLeads)} лидов без контакта`}>
            <div><span>Доля без контакта</span><strong>{percent(missed, newLeads)}</strong></div>
            <i style={{ "--focus-width": percent(missed, newLeads) } as CSSProperties} />
          </div>
          <div className="focus-stats">
            <div className="focus-stat">
              <span>Прошли через КЭВ</span>
              <strong>{data.kevCount}</strong>
            </div>
            <div className="focus-stat">
              <span>Сейчас на КЭВ</span>
              <strong>{trial}</strong>
            </div>
          </div>
        </article>
      </section>

      <section className="section-panel daily-chart-panel" aria-label="Динамика по дням">
        <div className="section-heading">
          <div>
            <h2>Лиды и касса по дням</h2>
          </div>
          <p>{periodLabel}</p>
        </div>
        <div className="daily-scroll">
          {dailyRows.map((day) => (
            <article className={`day-card ${day.isToday ? "today" : ""} ${day.isFuture ? "future" : ""}`} key={day.dateKey}>
              <div className="day-title">
                <strong>{day.date}</strong>
                {day.isToday && <span>сегодня</span>}
              </div>
              <dl>
                <div><dt>Новые лиды</dt><dd>{day.isFuture ? "—" : day.newLeads}</dd></div>
                <div><dt>Новые продажи</dt><dd>{day.isFuture ? "—" : nf.format(day.cash) + " ₸"}</dd></div>
                <div><dt>Повторные</dt><dd>{day.isFuture ? "—" : nf.format(day.repeatCash) + " ₸"}</dd></div>
                <div><dt>Бронь</dt><dd>{day.isFuture ? "—" : nf.format(day.bookingCash) + " ₸"}</dd></div>
                <div><dt>КЭВ</dt><dd>{day.isFuture ? "—" : day.kev}</dd></div>
                <div><dt>Оплаты</dt><dd>{day.isFuture ? "—" : day.payments}</dd></div>
              </dl>
            </article>
          ))}
        </div>
      </section>

      <section className="section-panel table-panel">
        <div className="section-heading">
          <div>
            <h2>Менеджеры и этапы</h2>
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr><th>Менеджер</th><th>В работе</th><th>Без контакта</th><th>Контакт</th><th>На пробный</th><th>Прошли КЭВ</th><th>КЭВ сейчас</th><th>Доля на пробном</th></tr>
            </thead>
            <tbody>
              {data.managers.map((manager) => {
                const managerBooked = manager.stageCounts["85342722"] ?? 0;
                return (
                  <tr key={manager.id}>
                    <td><span className="manager-avatar">{initials(manager.name)}</span><strong>{manager.name}</strong></td>
                    <td>{manager.total}</td>
                    <td>{manager.stageCounts["85172050"] ?? 0}</td>
                    <td>{manager.stageCounts["85171898"] ?? 0}</td>
                    <td>{managerBooked}</td>
                    <td>{manager.kevPassed}</td>
                    <td>{manager.stageCounts["85172062"] ?? 0}</td>
                    <td><span className="conversion-chip">{percent(managerBooked, manager.total)}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section-panel table-panel sales-panel">
        <div className="section-heading">
          <div>
            <h2>Реестр оплат</h2>
          </div>
          <p>{data.alfa.sales.length} операций · {periodLabel}</p>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr><th>Дата</th><th>Ученик</th><th>Оплачено</th><th>Продажа</th><th>Форма оплаты</th><th>Статья</th><th>№ операции</th></tr>
            </thead>
            <tbody>
              {data.alfa.sales.map((sale) => (
                <tr key={sale.id}>
                  <td className="date-cell">{sale.date}</td>
                  <td><strong>{sale.customer}</strong></td>
                  <td className="amount-cell">{nf.format(sale.amount)} ₸</td>
                  <td><span className={`sale-chip ${saleTypeClass(sale.saleType)}`}>{sale.saleType}</span></td>
                  <td><span className="payment-chip">{sale.paymentMethod}</span></td>
                  <td>{sale.category}</td>
                  <td className="muted-cell">#{sale.id}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
