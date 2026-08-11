"use client";

import {
  useCallback,
  useEffect,
  useMemo,
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
  note,
  tone = "light",
}: {
  label: string;
  value: string | number;
  note: string;
  tone?: "light" | "jade" | "amber" | "coral";
}) {
  return (
    <article className={`kpi-card kpi-${tone}`}>
      <p>{label}</p>
      <strong>{value}</strong>
      <span>{note}</span>
    </article>
  );
}

function ArticleCard({
  label,
  amount,
  count,
  tone,
}: {
  label: string;
  amount: number;
  count: number;
  tone: "first" | "repeat" | "booking" | "unknown";
}) {
  return (
    <article className={"article-card article-" + tone}>
      <span>{label}</span>
      <strong>{nf.format(amount) + " ₸"}</strong>
      <small>{count} оплат</small>
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
  const [managerId, setManagerId] = useState("all");
  const [appliedRange, setAppliedRange] = useState(initialData.range);
  const [customFrom, setCustomFrom] = useState(initialData.range.from);
  const [customTo, setCustomTo] = useState(initialData.range.to);
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

  const selectedManager = data.managers.find(
    (manager) => String(manager.id) === managerId,
  );
  const stages = useMemo(
    () => {
      const pipelineStages = data.stages.map((stage) => ({
        ...stage,
        count: selectedManager
          ? selectedManager.stageCounts[String(stage.id)] ?? 0
          : stage.count,
      }));
      if (selectedManager || !data.unsorted) return pipelineStages;
      return [
        { id: -1, name: "Неразобранное", count: data.unsorted, amount: 0, sort: -1 },
        ...pipelineStages,
      ];
    },
    [data.stages, data.unsorted, selectedManager],
  );

  const missed = findStage(stages, "недоз");
  const contact = findStage(stages, "контакт");
  const booked = findStage(stages, "записан");
  const trial = selectedManager ? selectedManager.kevCount : data.kevCount;
  const activeDeals = selectedManager
    ? selectedManager.total
    : data.activeDeals + data.unsorted;
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
      activations: alphaDay?.activations ?? 0,
      firstSales: alphaDay?.firstSales ?? 0,
      repeatSales: alphaDay?.repeatSales ?? 0,
      isToday: leadDay.isToday,
      isFuture: todayIndex >= 0 && index > todayIndex,
    };
  });
  const periodRows = dailyRows;
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
  const totalRevenue = cash + repeatCash + bookingCash + unspecifiedCash;
  const averageCheck = firstSales ? Math.round(cash / firstSales) : 0;
  const revenuePerLead = newLeads ? Math.round(totalRevenue / newLeads) : 0;
  const repeatShare = percent(repeatCash, totalRevenue);
  const overallKevRate = percent(data.kevCount, newLeads);
  const maxDailyLeads = Math.max(...dailyRows.map((day) => day.newLeads), 1);
  const maxDailyCash = Math.max(
    ...dailyRows.map((day) => day.cash + day.repeatCash + day.bookingCash),
    1,
  );
  const bestCashDay = dailyRows.reduce(
    (best, day) =>
      day.cash + day.repeatCash + day.bookingCash >
      best.cash + best.repeatCash + best.bookingCash
        ? day
        : best,
    dailyRows[0] ?? {
      dateKey: "",
      date: "—",
      newLeads: 0,
      cash: 0,
      repeatCash: 0,
      bookingCash: 0,
      payments: 0,
      activations: 0,
      firstSales: 0,
      repeatSales: 0,
      isToday: false,
      isFuture: false,
    },
  );
  const periodLabel = rangeLabel(appliedRange);
  const leadToSale = percent(firstSales, newLeads);
  const noContactPercent = newLeads ? Math.round((missed / newLeads) * 100) : 0;
  const contactPercent = newLeads ? Math.round((contact / newLeads) * 100) : 0;
  const selectPeriod = (nextPeriod: Exclude<DashboardPeriod, "custom">) => {
    if (nextPeriod === appliedRange.period && !isRefreshing) return;
    void refresh({ period: nextPeriod });
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
            <small>рука на пульсе</small>
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
          <p className="section-kicker">Образовательный центр китайского языка</p>
          <h1>Результат продаж</h1>
          <p className="overview-copy">
            {periodLabel} · ключевые показатели для руководителя
          </p>
        </div>

        <div className="overview-controls">
          <span className="control-label">Фильтр периода</span>
          <div className="period-switcher" role="group" aria-label="Быстрый выбор периода">
            <button
              type="button"
              className={appliedRange.period === "week" ? "active" : ""}
              onClick={() => selectPeriod("week")}
            >
              Последние 7 дней
            </button>
            <button
              type="button"
              className={appliedRange.period === "month" ? "active" : ""}
              onClick={() => selectPeriod("month")}
            >
              Этот месяц
            </button>
          </div>
          <form className="date-range-form" onSubmit={applyCustomPeriod}>
            <label>
              <span>С</span>
              <input
                type="date"
                value={customFrom}
                onChange={(event) => setCustomFrom(event.target.value)}
                required
              />
            </label>
            <label>
              <span>По</span>
              <input
                type="date"
                value={customTo}
                onChange={(event) => setCustomTo(event.target.value)}
                required
              />
            </label>
            <button type="submit" disabled={isRefreshing}>Применить</button>
          </form>
          {filterError ? <small className="filter-error">{filterError}</small> : <small>Один период для amoCRM, AlphaCRM, КЭВ и всех графиков.</small>}
        </div>
      </section>

      <section className="executive-kpis" aria-label="Ключевые показатели">
        <KpiCard
          label="Новые лиды"
          value={nf.format(newLeads)}
          note={data.unsorted ? `${newLeads - data.unsorted} сделок + ${data.unsorted} неразобранное` : periodLabel}
          tone="coral"
        />
        <KpiCard label="Новые продажи" value={nf.format(firstSales)} note="статья «Перв Китайский»" tone="jade" />
        <KpiCard label="Касса" value={nf.format(cash) + " ₸"} note={nf.format(firstSales) + " оплат «Перв Китайский»"} tone="amber" />
        <KpiCard label="Новые продажи / лиды" value={leadToSale} note={firstSales + " оплат «Перв Китайский» ÷ " + newLeads + " лидов"} tone="light" />
        <KpiCard label="Средний чек" value={nf.format(averageCheck) + " ₸"} note="по статье «Перв Китайский»" tone="light" />
        <KpiCard
          label="Прошли через КЭВ"
          value={nf.format(data.kevCount)}
          note={`уникальные лиды по истории переходов · ${overallKevRate} от новых лидов`}
          tone="light"
        />
      </section>

      <section className="article-breakdown" aria-label="Продажи по статьям AlfaCRM">
        <ArticleCard label="Не указано" amount={unspecifiedCash} count={unspecifiedSales.length} tone="unknown" />
        <ArticleCard label="Повт Китайский · повторная касса" amount={repeatCash} count={repeatSales} tone="repeat" />
        <ArticleCard label="Бронь" amount={bookingCash} count={bookingSales.length} tone="booking" />
      </section>

      <section className="plan-panel" aria-label="План месяца">
        <div className="plan-heading">
          <div>
            <p className="section-kicker">План месяца</p>
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
        ) : (
          <p className="plan-week-note">План задаётся на месяц. Выберите «Этот месяц», чтобы сравнить его с фактом и изменить цели.</p>
        )}
      </section>

      <section className="metric-explainer" aria-label="Как читать показатели"> 
        <strong>Как читать цифры</strong>
        <p>
          Касса считается только по статье «Перв Китайский». Статья «Повт Китайский» попадает только в повторную кассу, а «Бронь» и «Не указано» отображаются отдельно. Средний чек — касса, делённая на количество оплат «Перв Китайский».
        </p>
        <p>
          «Новые продажи / лиды» — оперативное соотношение за один период, а не сквозная конверсия одного и того же клиента. «Прошли через КЭВ» считает уникальные сделки по истории смены этапов: лид остаётся в показателе, даже если уже перешёл дальше или был закрыт.
        </p>
      </section>

      <section className="executive-grid">
        <article className="section-panel funnel-panel">
          <div className="section-heading">
            <div>
              <p className="section-kicker">Воронка продаж</p>
              <h2>Где теряются лиды</h2>
            </div>
            <p>{activeDeals} сделок в работе{!selectedManager && data.unsorted ? ` · ${data.unsorted} неразобранное` : ""}</p>
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
          <p className="panel-note">Процент — доля всех лидов выбранного периода, которые сейчас находятся на этом этапе. Это не конверсия перехода между этапами.</p>
        </article>

        <article className="section-panel focus-panel">
          <div className="focus-symbol">中</div>
          <p className="section-kicker">Точка внимания</p>
          <h2>{missed} лидов ещё не получили качественный контакт</h2>
          <p>
            Это {percent(missed, newLeads)} от новых лидов выбранного периода. Контакт сделан у {contact} лидов, а на пробный урок записаны {booked}.
          </p>
          <div className="focus-stat">
            <span>Прошли через КЭВ за период</span>
            <strong>{trial}</strong>
          </div>
        </article>
      </section>

      <section className="section-panel analytics-panel" aria-label="Глубокая аналитика">
        <div className="section-heading">
          <div>
            <p className="section-kicker">Глубокая аналитика</p>
            <h2>Экономика и ритм потока</h2>
          </div>
          <p>{periodLabel}</p>
        </div>
        <div className="analytics-kpis">
          <article>
            <span>Выручка на новый лид</span>
            <strong>{nf.format(revenuePerLead)} ₸</strong>
            <small>вся касса AlphaCRM ÷ новые лиды amoCRM</small>
          </article>
          <article>
            <span>Доля повторной кассы</span>
            <strong>{repeatShare}</strong>
            <small>{nf.format(repeatCash)} ₸ из {nf.format(totalRevenue)} ₸</small>
          </article>
          <article>
            <span>Интенсивность КЭВ</span>
            <strong>{overallKevRate}</strong>
            <small>{data.kevCount} переходов КЭВ к {newLeads} новым лидам</small>
          </article>
          <article>
            <span>Самый денежный день</span>
            <strong>{bestCashDay.date}</strong>
            <small>{nf.format(bestCashDay.cash + bestCashDay.repeatCash + bestCashDay.bookingCash)} ₸</small>
          </article>
        </div>
        <div className="combo-chart" role="img" aria-label="Сравнение новых лидов и кассы по дням">
          <div className="chart-legend"><span className="leads-legend">Новые лиды</span><span className="cash-legend">Касса</span></div>
          <div className="chart-scroll">
            {dailyRows.map((day) => {
              const dailyCash = day.cash + day.repeatCash + day.bookingCash;
              return (
                <div className="chart-day" key={day.dateKey} title={`${day.date}: ${day.newLeads} лидов, ${nf.format(dailyCash)} ₸`}>
                  <div className="chart-bars">
                    <i className="leads-bar" style={{ "--height": `${Math.max(day.newLeads ? 8 : 0, (day.newLeads / maxDailyLeads) * 100)}%` } as CSSProperties} />
                    <i className="cash-bar" style={{ "--height": `${Math.max(dailyCash ? 8 : 0, (dailyCash / maxDailyCash) * 100)}%` } as CSSProperties} />
                  </div>
                  <span>{day.date}</span>
                </div>
              );
            })}
          </div>
        </div>
        <p className="panel-note">Показатель КЭВ — поток переходов за период, а не когортная конверсия: часть лидов могла быть создана раньше. Выручка на лид — управленческий индикатор общей эффективности периода.</p>
      </section>

      <section className="section-panel">
        <div className="section-heading">
          <div>
            <p className="section-kicker">Динамика</p>
            <h2>Лиды и деньги по дням</h2>
          </div>
          <p>{periodLabel}</p>
        </div>

        <div className="daily-scroll">
          {periodRows.map((day) => (
            <article className={`day-card ${day.isToday ? "today" : ""} ${day.isFuture ? "future" : ""}`} key={day.dateKey}>
              <div className="day-title">
                <strong>{day.date}</strong>
                {day.isToday && <span>сегодня</span>}
              </div>
              <dl>
                <div><dt>Новые лиды</dt><dd>{day.isFuture ? "—" : day.newLeads}</dd></div>
                <div><dt>Касса</dt><dd>{day.isFuture ? "—" : nf.format(day.cash) + " ₸"}</dd></div>
                <div><dt>Повторная касса</dt><dd>{day.isFuture ? "—" : nf.format(day.repeatCash) + " ₸"}</dd></div>
                <div><dt>Бронь</dt><dd>{day.isFuture ? "—" : nf.format(day.bookingCash) + " ₸"}</dd></div>
              </dl>
            </article>
          ))}
        </div>
      </section>

      <section className="section-panel table-panel">
        <div className="section-heading team-heading">
          <div>
            <p className="section-kicker">Команда</p>
            <h2>Менеджеры и этапы</h2>
          </div>
          <div className="manager-filter">
            <label htmlFor="manager">Фокус воронки</label>
            <select id="manager" value={managerId} onChange={(event) => setManagerId(event.target.value)}>
              <option value="all">Все менеджеры</option>
              {data.managers.map((manager) => <option key={manager.id} value={manager.id}>{manager.name}</option>)}
            </select>
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr><th>Менеджер</th><th>В работе</th><th>Без контакта</th><th>Контакт</th><th>На пробный</th><th>КЭВ</th><th>Доля на пробном</th></tr>
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
                    <td>{manager.kevCount}</td>
                    <td><span className="conversion-chip">{percent(managerBooked, manager.total)}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section-panel table-panel kev-panel">
        <div className="section-heading">
          <div>
            <p className="section-kicker">История КЭВ</p>
            <h2>Все лиды, прошедшие через КЭВ</h2>
          </div>
          <p>{data.kevLeads.length} уникальных лидов · {periodLabel}</p>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr><th>Вход в КЭВ</th><th>Лид</th><th>Ответственный</th><th>Текущий этап</th><th>№ сделки</th></tr>
            </thead>
            <tbody>
              {data.kevLeads.length ? data.kevLeads.map((lead) => (
                <tr key={lead.id}>
                  <td className="date-cell">{lead.enteredAt}</td>
                  <td><strong>{lead.name}</strong></td>
                  <td>{lead.manager}</td>
                  <td><span className="stage-chip">{lead.currentStage}</span></td>
                  <td className="muted-cell">#{lead.id}</td>
                </tr>
              )) : (
                <tr><td colSpan={5} className="empty-table">За выбранный период переходов в КЭВ не найдено</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="data-note">Каждая сделка показана один раз по первому входу в КЭВ внутри выбранного периода. Текущий этап может быть любым — переход не теряется после дальнейшего движения по воронке.</p>
      </section>

      <section className="section-panel table-panel sales-panel">
        <div className="section-heading">
          <div>
            <p className="section-kicker">Детализация</p>
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
        <p className="data-note">Тип продажи определяется статьёй оплаты: «Перв Китайский» — первая, «Повт Китайский» — повторная, «Бронь» — бронь. Если статья отсутствует или не распознана, показано «Не указано».</p>
      </section>

      <footer className="rnp-footer">
        <span>РНП · аналитика продаж</span>
        <span>amoCRM {data.updatedAt} · AlfaCRM {data.alfa.updatedAt}</span>
      </footer>
    </main>
  );
}
