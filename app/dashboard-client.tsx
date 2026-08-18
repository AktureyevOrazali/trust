"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { DashboardData, DashboardPeriod, DashboardRange } from "@/lib/dashboard";

const nf = new Intl.NumberFormat("ru-RU");
const dateFormat = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
const STAGE_COLORS = ["#C1472C", "#E07A45", "#E7A24A", "#9CBB6E", "#6FAE8C", "#3C7A5C", "#16332C", "#C7C2B2"];

function money(value: number) { return `${nf.format(Math.round(value))} ₸`; }
function percentage(value: number, total: number) { return total ? Math.round((value / total) * 100) : 0; }
function initials(name: string) { return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase(); }
function stageCount(stages: DashboardData["stages"], fragment: string) {
  return stages.find((stage) => stage.name.toLocaleLowerCase("ru").includes(fragment.toLocaleLowerCase("ru")))?.count ?? 0;
}
function articleGroup(category: string) {
  const value = category.toLocaleLowerCase("ru");
  if (value.includes("перв китай")) return "first";
  if (value.includes("повт китай")) return "repeat";
  if (value.includes("бронь")) return "booking";
  return "other";
}
function saleBadge(saleType: string) {
  if (saleType === "Первая") return "new";
  if (saleType === "Повторная") return "repeat";
  if (saleType === "Бронь") return "book";
  return "unknown";
}
function rangeLabel(range: DashboardRange) { return `${dateFormat.format(new Date(`${range.from}T12:00:00Z`))} — ${dateFormat.format(new Date(`${range.to}T12:00:00Z`))}`; }
function monthYear(value: string) {
  const label = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
  return label.charAt(0).toUpperCase() + label.slice(1);
}
function compactForecast(value: number, isMoney: boolean) {
  if (isMoney && value >= 1_000_000) return `${(value / 1_000_000).toLocaleString("ru-RU", { maximumFractionDigits: 2 })}М`;
  if (isMoney) return `${Math.round(value / 1_000)}К`;
  if (value < 100) return nf.format(Math.round(value));
  return nf.format(Math.round(value / 100) * 100);
}
function periodProgress(range: DashboardRange) {
  const start = new Date(`${range.from}T00:00:00Z`);
  const end = new Date(`${range.to}T00:00:00Z`);
  const today = new Date();
  const days = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
  const elapsed = Math.max(1, Math.min(days, Math.floor((today.getTime() - start.getTime()) / 86_400_000) + 1));
  const isMonth = range.period === "month";
  const monthDays = isMonth ? new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate() : days;
  return { elapsed: isMonth ? Math.min(elapsed, monthDays) : elapsed, total: monthDays, share: Math.min(1, (isMonth ? elapsed : elapsed) / monthDays) };
}

type PaceMetric = { label: string; sub?: string; fact: number; plan: number; isMoney?: boolean };

function PaceRow({ metric, elapsedShare, elapsedDays, totalDays }: { metric: PaceMetric; elapsedShare: number; elapsedDays: number; totalDays: number }) {
  const actual = metric.plan ? metric.fact / metric.plan : 0;
  const forecast = elapsedDays ? (metric.fact / elapsedDays) * totalDays : 0;
  const forecastShare = metric.plan ? forecast / metric.plan : 0;
  const tone = forecastShare >= 0.9 ? "good" : forecastShare >= 0.5 ? "watch" : "behind";
  const actualPercent = Math.round(actual * 100);
  const expectedPercent = Math.round(elapsedShare * 100);
  return <tr>
    <td className="metric">{metric.label}{metric.sub && <span className="sub">{metric.sub}</span>}</td>
    <td className="fact">{metric.isMoney ? money(metric.fact) : nf.format(metric.fact)}</td>
    <td className="plan-val">{metric.isMoney ? money(metric.plan) : nf.format(metric.plan)}</td>
    <td className="bar-cell"><div className="pace-track"><i className={`pace-fill ${tone}`} style={{ width: `${Math.min(100, actualPercent)}%` }} /><i className="pace-marker" style={{ left: `${expectedPercent}%` }} /></div><div className="pace-pct"><b className={tone}>{actualPercent}%</b> выполнено · ожидалось ≈{expectedPercent}%</div></td>
    <td className="forecast"><span className="fc-label">прогноз</span>≈{metric.isMoney ? `${compactForecast(forecast, true)} ₸` : compactForecast(forecast, false)} <b className={tone}>({Math.round(forecastShare * 100)}%)</b></td>
  </tr>;
}

function PercentPaceRow({ label, sub, fact, target, limit }: { label: string; sub: string; fact: number; target: number; limit?: boolean }) {
  const status = limit ? fact <= target : fact >= target;
  const tone = status ? "good" : "behind";
  const fill = Math.min(100, (fact / Math.max(target, 1)) * 100);
  return <tr><td className="metric">{label}<span className="sub">{sub}</span></td><td className="fact">{fact}%</td><td className="plan-val">{limit ? "≤" : "≥"}{target}%</td><td className="bar-cell"><div className="pace-track"><i className={`pace-fill ${tone}`} style={{ width: `${fill}%` }} /></div><div className="pace-pct"><b className={tone}>{fact}%</b> факт за период · цель {limit ? "не выше" : "не ниже"} {target}%</div></td><td className="forecast">—</td></tr>;
}

export function DashboardClient({ data: initialData }: { data: DashboardData }) {
  const [data, setData] = useState(initialData);
  const [range, setRange] = useState(initialData.range);
  const [customOpen, setCustomOpen] = useState(initialData.range.period === "custom");
  const [from, setFrom] = useState(initialData.range.from);
  const [to, setTo] = useState(initialData.range.to);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [registryOpen, setRegistryOpen] = useState(false);

  const refresh = useCallback(async (requested: Pick<DashboardRange, "period"> & Partial<DashboardRange>, force = false) => {
    setRefreshing(true); setError("");
    try {
      const search = new URLSearchParams({ period: requested.period });
      if (requested.from) search.set("from", requested.from);
      if (requested.to) search.set("to", requested.to);
      if (force) search.set("force", "1");
      const response = await fetch(`/api/dashboard?${search}`, { cache: "no-store" });
      const result = await response.json() as DashboardData & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Не удалось обновить данные");
      setData(result); setRange(result.range); setFrom(result.range.from); setTo(result.range.to); setRegistryOpen(false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось обновить данные"); }
    finally { setRefreshing(false); }
  }, []);

  useEffect(() => { const timer = window.setInterval(() => void refresh(range), 120_000); return () => window.clearInterval(timer); }, [range, refresh]);

  const derived = useMemo(() => {
    const stages = data.unsorted ? [{ id: -1, name: "Неразобранные заявки", count: data.unsorted, amount: 0, sort: -1 }, ...data.stages] : data.stages;
    const leads = data.trend.reduce((sum, day) => sum + day.value, 0);
    const missed = stageCount(stages, "недоз");
    const contact = stageCount(stages, "контакт");
    const trial = stageCount(stages, "кэв");
    const first = data.alfa.sales.filter((sale) => articleGroup(sale.category) === "first");
    const repeat = data.alfa.sales.filter((sale) => articleGroup(sale.category) === "repeat");
    const booking = data.alfa.sales.filter((sale) => articleGroup(sale.category) === "booking");
    const other = data.alfa.sales.filter((sale) => articleGroup(sale.category) === "other");
    const sum = (sales: typeof first) => sales.reduce((total, sale) => total + sale.amount, 0);
    const firstCash = sum(first), repeatCash = sum(repeat), bookingCash = sum(booking), otherCash = sum(other);
    return { stages, leads, missed, contact, trial, first, firstCash, repeatCash, bookingCash, otherCash, totalCash: firstCash + repeatCash + bookingCash + otherCash };
  }, [data]);
  const progress = periodProgress(range);
  const activation = percentage(derived.first.length, derived.leads);
  const averageCheck = derived.first.length ? Math.round(derived.firstCash / derived.first.length) : 0;
  const metrics: PaceMetric[] = [
    { label: "Новый лид", fact: derived.leads, plan: data.plan.newLeads },
    { label: "Касса", sub: "новая, план и факт — только по новым продажам", fact: derived.firstCash, plan: data.plan.revenue, isMoney: true },
    { label: "Активация новый", sub: "кол-во новых продаж", fact: derived.first.length, plan: data.plan.newSales },
    { label: "Повторная касса", sub: "свой план — не суммировать с новой кассой", fact: derived.repeatCash, plan: data.plan.repeatRevenue, isMoney: true },
  ];
  const ranked = [...metrics].map((metric) => ({ metric, forecastShare: metric.plan ? ((metric.fact / progress.elapsed) * progress.total) / metric.plan : 0 })).sort((a, b) => a.forecastShare - b.forecastShare);
  const worst = ranked[0]?.metric, second = ranked[1]?.metric, best = ranked.at(-1)?.metric;
  const insightText = (metric: PaceMetric) => {
    const forecast = (metric.fact / progress.elapsed) * progress.total;
    return `Факт ${metric.isMoney ? money(metric.fact) : nf.format(metric.fact)} из ${metric.isMoney ? money(metric.plan) : nf.format(metric.plan)} (${Math.round((metric.fact / metric.plan) * 100)}%) — при текущем темпе к концу периода выйдет ≈${metric.isMoney ? `${compactForecast(forecast, true)} ₸` : compactForecast(forecast, false)}.`;
  };
  const daily = data.trend.map((lead) => {
    const alpha = data.alfa.daily.find((day) => day.dateKey === lead.date);
    return { ...lead, first: alpha?.firstChineseCash ?? 0, repeat: alpha?.repeatChineseCash ?? 0 };
  });
  const dailyMax = Math.max(...daily.flatMap((day) => [day.first, day.repeat]), 1);
  const registry = [...data.alfa.sales].sort((a, b) => b.dateKey.localeCompare(a.dateKey) || b.id - a.id);
  const visibleRegistry = registry.slice(0, 8), remainingRegistry = registry.slice(8);
  const selectPeriod = (period: Exclude<DashboardPeriod, "custom">) => { setCustomOpen(false); if (period !== range.period) void refresh({ period }); };
  const applyCustom = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void refresh({ period: "custom", from, to }); };

  return <main className="rnp-shell">
    <header className="topbar">
      <a className="brand" href="#overview"><span className="brand-mark">中</span><span><b>РНП</b><small>центр китайского языка</small></span></a>
      <div className="dashboard-toolbar" aria-label="Фильтр периода"><div className="period-switcher" role="group" aria-label="Быстрый выбор периода"><button type="button" className={range.period === "week" && !customOpen ? "active" : ""} onClick={() => selectPeriod("week")}>Неделя</button><button type="button" className={range.period === "month" && !customOpen ? "active" : ""} onClick={() => selectPeriod("month")}>Этот месяц</button><button type="button" className={customOpen ? "active" : ""} onClick={() => setCustomOpen(true)}>Свои даты</button></div>
      {customOpen && <form className="date-range-form" onSubmit={applyCustom}><label>С<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} required /></label><label>По<input type="date" value={to} onChange={(event) => setTo(event.target.value)} required /></label><button type="submit" disabled={refreshing}>Применить</button></form>}
      <button className={`refresh-control ${refreshing ? "spinning" : ""}`} type="button" onClick={() => void refresh(range, true)} disabled={refreshing}><span>↻</span>Обновить</button></div>
    </header>
    {error && <p className="filter-error">{error}</p>}

    <section className="title-row" id="overview"><h1 className="title">Результат продаж</h1><p className="title-meta">{rangeLabel(range)} · день <b>{progress.elapsed}</b> из {progress.total} · месяц пройден на <b>{Math.round(progress.share * 100)}%</b></p></section>
    <section className="hero-row" aria-label="Ключевые показатели"><article className="hero-card"><div className="hero-label">Касса за период</div><div><div className="hero-number">{money(derived.totalCash)}</div><div className="hero-foot"><span>новая {money(derived.firstCash)}</span><span>·</span><span>повторная {money(derived.repeatCash)}</span><span>·</span><span>бронь {money(derived.bookingCash)}</span><span>·</span><span>не опр. {money(derived.otherCash)}</span></div></div></article><article className="kpi-card"><div className="kpi-label">Новые продажи / лиды</div><div className="kpi-number">{activation}%</div><div className="kpi-foot">{derived.first.length} продаж из {derived.leads} лидов</div></article><article className="kpi-card"><div className="kpi-label">Средний чек</div><div className="kpi-number">{money(averageCheck)}</div><div className="kpi-foot">по {derived.first.length} новым продажам</div></article></section>
    <p className="hero-note">Цифра выше — общая касса за период для быстрого взгляда, без сравнения с планом: у новой и повторной кассы разные цели и разный процент выполнения.</p>
    <section className="chip-row" aria-label="Второстепенные показатели"><article className="chip accent-red"><span>Новые лиды</span><b>{nf.format(derived.leads)}</b></article><article className="chip"><span>Новые продажи</span><b>{nf.format(derived.first.length)}</b></article><article className="chip"><span>Новые — касса</span><b>{money(derived.firstCash)}</b></article><article className="chip accent-amber"><span>Повторные — касса</span><b>{money(derived.repeatCash)}</b></article><article className="chip accent-book"><span>Бронь — касса</span><b>{money(derived.bookingCash)}</b></article><article className="chip"><span>Не определено</span><b>{money(derived.otherCash)}</b></article></section>

    <section className="section"><div className="section-head"><h2>Ключевые наблюдения</h2><p>рассчитано автоматически на основе данных периода</p></div><div className="insights"><article className="insight warn"><b>⚠ Риск плана — {worst?.label ?? "нет данных"}</b><p>{worst ? insightText(worst) : "Недостаточно данных для прогноза."}</p></article><article className="insight warn"><b>⚠ Требует внимания — {second?.label ?? "воронка"}</b><p>{second ? insightText(second) : `Без качественного контакта остаются ${derived.missed} лидов.`}</p></article><article className="insight good"><b>✓ {best && ranked.at(-1)!.forecastShare >= 0.9 ? `В норме — ${best.label}` : "На что смотреть отдельно"}</b><p>{best && ranked.at(-1)!.forecastShare >= 0.9 ? insightText(best) : "Новая и повторная касса — разные каналы с разными планами. Их факты нельзя объединять для оценки выполнения цели."}</p></article></div></section>

    <section className="section plan-section"><div className="section-head"><h2>Темп выполнения плана — {monthYear(range.from)}</h2><p>«сегодня» = ожидаемый прогресс на {Math.round(progress.share * 100)}% периода</p></div><div className="table-scroll"><table className="plan"><thead><tr><th>Показатель</th><th>Факт</th><th>План</th><th>Темп к сегодняшнему дню</th><th>Прогноз на конец периода</th></tr></thead><tbody><PaceRow metric={metrics[0]} elapsedShare={progress.share} elapsedDays={progress.elapsed} totalDays={progress.total} /><PercentPaceRow label="НДЗВ" sub={`${derived.missed} из ${derived.leads} лидов · лимит`} fact={percentage(derived.missed, derived.leads)} target={data.plan.noContactPercent} limit /><PercentPaceRow label="Контакт" sub={`${derived.contact} из ${derived.leads} лидов`} fact={percentage(derived.contact, derived.leads)} target={data.plan.contactPercent} /><PaceRow metric={metrics[1]} elapsedShare={progress.share} elapsedDays={progress.elapsed} totalDays={progress.total} /><PaceRow metric={metrics[2]} elapsedShare={progress.share} elapsedDays={progress.elapsed} totalDays={progress.total} /><PaceRow metric={metrics[3]} elapsedShare={progress.share} elapsedDays={progress.elapsed} totalDays={progress.total} /></tbody></table></div><p className="plan-warning">⚠ <b>Новая</b> и <b>повторная</b> касса — это две разные цели с разными планами. Не складывайте их факты в один показатель: вместе они не отражают ни один реальный план.</p></section>

    <section className="two-col"><article className="section funnel-section"><div className="section-head"><h2>Распределение лидов по этапам</h2><p>{nf.format(derived.stages.reduce((sum, stage) => sum + stage.count, 0))} лидов за период</p></div>{derived.stages.map((stage, index) => { const max = Math.max(...derived.stages.map((item) => item.count), 1); return <div className="funnel-row" key={stage.id}><div className="funnel-label"><b>{String(index + 1).padStart(2, "0")}</b>{stage.name}</div><div className="funnel-track"><i className="funnel-fill" style={{ width: `${Math.max(3, stage.count / max * 100)}%`, background: STAGE_COLORS[index % STAGE_COLORS.length] }} /></div><strong className="funnel-value">{stage.count}</strong></div>; })}</article><article className="priority-card"><span>Приоритет команды</span><small>Без качественного контакта</small><b className="priority-number">{derived.missed}</b><p>лидов требуют обработки сегодня</p><div className="priority-bar-label"><span>Доля без контакта</span><b>{percentage(derived.missed, derived.leads)}%</b></div><div className="priority-track"><i style={{ width: `${percentage(derived.missed, derived.leads)}%` }} /></div><div className="focus-stats"><div><b>{data.kevCount}</b><span>прошли через КЭВ</span></div><div><b>{derived.trial}</b><span>сейчас на КЭВ</span></div></div></article></section>

    <section className="section"><div className="section-head"><h2>Касса по дням — новая vs повторная</h2><p>{rangeLabel(range)}</p></div><div className="daily-scroll">{daily.map((day) => <div className="day-card chart-day" key={day.date}><div className="chart-bars"><i className="new-bar" style={{ height: `${day.first / dailyMax * 100}%` }} title={`Новая: ${money(day.first)}`} /><i className="repeat-bar" style={{ height: `${day.repeat / dailyMax * 100}%` }} title={`Повторная: ${money(day.repeat)}`} /></div><span>{day.label}</span></div>)}</div><div className="chart-legend"><span><i className="dot new-dot" />новая касса</span><span><i className="dot repeat-dot" />повторная касса</span></div></section>

    <section className="section"><div className="section-head"><h2>Менеджеры и этапы</h2><p>доля на пробном — от сделок менеджера</p></div><div className="table-scroll"><table className="mgr"><thead><tr><th>Менеджер</th><th>В работе</th><th>Без контакта</th><th>Контакт</th><th>На пробный</th><th>Прошли КЭВ</th><th>КЭВ сейчас</th><th>Доля на пробном</th></tr></thead><tbody>{data.managers.map((manager) => { const booked = manager.stageCounts["85342722"] ?? 0; const currentKev = manager.stageCounts["85172062"] ?? 0; const rate = percentage(booked, manager.total); return <tr key={manager.id}><td><div className="mgr-name"><i className="mgr-avatar">{initials(manager.name)}</i>{manager.name}</div></td><td className="num">{manager.total}</td><td className="num">{manager.stageCounts["85172050"] ?? 0}</td><td className="num">{manager.stageCounts["85171898"] ?? 0}</td><td className="num">{booked}</td><td className="num">{manager.kevPassed}</td><td className="num">{currentKev}</td><td><div className="conv-bar-wrap"><i><b style={{ width: `${rate}%` }} /></i><span>{rate}%</span></div></td></tr>; })}</tbody></table></div></section>

    <section className="section"><div className="section-head"><h2>Реестр оплат</h2><p>показаны последние {Math.min(8, registry.length)} из {registry.length} операций</p></div><div className="table-scroll"><table className="reg"><thead><tr><th>Дата</th><th>Ученик</th><th>Оплачено</th><th>Продажа</th><th>Форма оплаты</th><th>Статья</th><th>№ операции</th></tr></thead><tbody>{visibleRegistry.map((sale) => <RegistryRow key={sale.id} sale={sale} />)}</tbody>{registryOpen && <tbody>{remainingRegistry.map((sale) => <RegistryRow key={sale.id} sale={sale} />)}</tbody>}</table></div>{remainingRegistry.length > 0 && <button className="reg-toggle" type="button" onClick={() => setRegistryOpen((open) => !open)}>{registryOpen ? "Свернуть" : `Показать все ${registry.length} операций`}</button>}</section>
  </main>;
}

function RegistryRow({ sale }: { sale: DashboardData["alfa"]["sales"][number] }) {
  return <tr><td>{sale.date}</td><td><b>{sale.customer}</b></td><td className="reg-sum">{money(sale.amount)}</td><td>{sale.saleType === "Не указано" ? "—" : <span className={`badge ${saleBadge(sale.saleType)}`}>{sale.saleType}</span>}</td><td>{sale.paymentMethod}</td><td>{sale.category}</td><td>#{sale.id}</td></tr>;
}
