import { env } from "cloudflare:workers";
import {
  periodDates,
  periodEndSeconds,
  periodStartSeconds,
  type DashboardRange,
} from "./period";

const PIPELINE_ID = 10819798;
const KEV_STATUS_ID = 85172062;
const CLOSED_STATUS_IDS = new Set([142, 143]);
const AMO_PAGE_LIMIT = 250;
const AMO_EVENT_PAGE_LIMIT = 100;
const CACHE_TTL_MS = 60_000;

export type SourceStatus = "live" | "cached" | "stored" | "unavailable";

export interface DashboardStage {
  id: number;
  name: string;
  count: number;
  amount: number;
  sort: number;
}

export interface ManagerSnapshot {
  id: number;
  name: string;
  total: number;
  stageCounts: Record<string, number>;
  kevPassed: number;
}

export interface TrendPoint {
  date: string;
  label: string;
  value: number;
  isToday: boolean;
}

export interface AmoDashboardData {
  connected: boolean;
  sourceStatus: SourceStatus;
  statusMessage: string;
  activeDeals: number;
  activeAmount: number;
  unsorted: number;
  stages: DashboardStage[];
  managers: ManagerSnapshot[];
  trend: TrendPoint[];
  kevCount: number;
  kevByDate: Record<string, number>;
  updatedAt: string;
}

type AmoRuntime = {
  DB?: D1Database;
  AMO_BASE_URL?: string;
  AMO_ACCESS_TOKEN?: string;
};

type AmoLead = {
  id: number;
  name?: string;
  pipeline_id: number;
  status_id: number;
  responsible_user_id: number;
  price?: number;
  created_at: number;
};

type AmoUnsorted = {
  created_at?: number;
  pipeline_id?: number;
};

type AmoEvent = {
  entity_id: number;
  created_by: number;
  created_at: number;
  value_after?: Array<{
    lead_status?: { id?: number; pipeline_id?: number };
  }>;
};

type CachedAmo = { data: AmoDashboardData; expiresAt: number };
const cache = new Map<string, CachedAmo>();
const inFlight = new Map<string, Promise<AmoDashboardData>>();

function rangeKey(range: DashboardRange): string {
  return `${range.from}:${range.to}`;
}

function formatUpdatedAt(timestamp: number): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Qyzylorda",
  }).format(new Date(timestamp));
}

function dateKey(timestamp: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Qyzylorda",
  }).format(new Date(timestamp * 1000));
}

function dateLabel(date: Date): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Qyzylorda",
  }).format(date);
}

function emptyAmoData(range: DashboardRange, message: string): AmoDashboardData {
  const todayKey = dateKey(Math.floor(Date.now() / 1000));
  return {
    connected: false,
    sourceStatus: "unavailable",
    statusMessage: message,
    activeDeals: 0,
    activeAmount: 0,
    unsorted: 0,
    stages: [],
    managers: [],
    trend: periodDates(range).map((date) => {
      const key = date.toISOString().slice(0, 10);
      return { date: key, label: dateLabel(date), value: 0, isToday: key === todayKey };
    }),
    kevCount: 0,
    kevByDate: {},
    updatedAt: "нет данных",
  };
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function amoRequest<T>(
  baseUrl: string,
  token: string,
  path: string,
): Promise<T> {
  let lastMessage = "amoCRM не ответила";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      });
      if (response.status === 204) return {} as T;
      if (response.ok) return response.json() as Promise<T>;

      const body = await response.text();
      lastMessage = `amoCRM HTTP ${response.status}: ${body.slice(0, 180)}`;
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === 2) throw new Error(lastMessage);
      const retryAfter = Number(response.headers.get("retry-after"));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : 400 * 2 ** attempt);
    } catch (error) {
      lastMessage = error instanceof Error ? error.message : lastMessage;
      if (attempt === 2) throw new Error(lastMessage);
      await sleep(400 * 2 ** attempt);
    }
  }
  throw new Error(lastMessage);
}

async function amoCollection<T>(
  baseUrl: string,
  token: string,
  path: string,
  embeddedKey: string,
  limit = AMO_PAGE_LIMIT,
): Promise<T[]> {
  const items: T[] = [];

  for (let page = 1; page <= 100; page += 1) {
    const separator = path.includes("?") ? "&" : "?";
    const body = await amoRequest<{
      _embedded?: Record<string, unknown>;
      _links?: { next?: { href?: string } };
    }>(baseUrl, token, `${path}${separator}limit=${limit}&page=${page}`);
    const pageItems = body._embedded?.[embeddedKey];
    const list = Array.isArray(pageItems) ? (pageItems as T[]) : [];
    items.push(...list);

    if (!body._links?.next?.href || list.length === 0) break;
  }

  return items;
}

function leadQueryPath(range: DashboardRange): string {
  const params = new URLSearchParams();
  params.set("filter[pipeline_id]", String(PIPELINE_ID));
  params.set("filter[created_at][from]", String(periodStartSeconds(range)));
  params.set("filter[created_at][to]", String(periodEndSeconds(range)));
  return `/api/v4/leads?${params.toString()}`;
}

function kevEventQueryPath(range: DashboardRange): string {
  const params = new URLSearchParams();
  params.set("filter[entity]", "lead");
  params.set("filter[type]", "lead_status_changed");
  params.set("filter[created_at][from]", String(periodStartSeconds(range)));
  params.set("filter[created_at][to]", String(periodEndSeconds(range)));
  params.set(
    "filter[value_after][leads_statuses][0][pipeline_id]",
    String(PIPELINE_ID),
  );
  params.set(
    "filter[value_after][leads_statuses][0][status_id]",
    String(KEV_STATUS_ID),
  );
  return `/api/v4/events?${params.toString()}`;
}

function buildTrend(
  leads: AmoLead[],
  range: DashboardRange,
): TrendPoint[] {
  const countsByDate = new Map<string, number>();
  for (const lead of leads) {
    if (!lead.created_at) continue;
    const key = dateKey(lead.created_at);
    countsByDate.set(key, (countsByDate.get(key) ?? 0) + 1);
  }
  const todayKey = dateKey(Math.floor(Date.now() / 1000));
  return periodDates(range).map((date) => {
    const key = date.toISOString().slice(0, 10);
    return {
      date: key,
      label: dateLabel(date),
      value: countsByDate.get(key) ?? 0,
      isToday: key === todayKey,
    };
  });
}

function uniqueKevEvents(events: AmoEvent[]): Map<number, AmoEvent> {
  const byLead = new Map<number, AmoEvent>();
  for (const event of events) {
    const status = event.value_after?.[0]?.lead_status;
    if (status?.id !== KEV_STATUS_ID || status.pipeline_id !== PIPELINE_ID) continue;
    const current = byLead.get(event.entity_id);
    if (!current || event.created_at < current.created_at) {
      byLead.set(event.entity_id, event);
    }
  }
  return byLead;
}

function kevCountsByDate(events: Iterable<AmoEvent>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const event of events) {
    const key = dateKey(event.created_at);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function addKevPassedByManager(
  managerMap: Map<number, ManagerSnapshot>,
  users: Map<number, string>,
  leads: AmoLead[],
  kevEvents: Map<number, AmoEvent>,
) {
  for (const lead of leads) {
    if (lead.status_id !== KEV_STATUS_ID && !kevEvents.has(lead.id)) continue;
    ensureManager(managerMap, users, lead.responsible_user_id).kevPassed += 1;
  }
}

function ensureManager(
  managerMap: Map<number, ManagerSnapshot>,
  users: Map<number, string>,
  userId: number,
): ManagerSnapshot {
  const current = managerMap.get(userId);
  if (current) return current;
  const manager = {
    id: userId,
    name: users.get(userId) ?? `Менеджер ${userId}`,
    total: 0,
    stageCounts: {},
    kevPassed: 0,
  };
  managerMap.set(userId, manager);
  return manager;
}

async function getLiveAmoDashboardData(
  baseUrlValue: string,
  token: string,
  range: DashboardRange,
): Promise<AmoDashboardData> {
  const baseUrl = baseUrlValue.trim().replace(/\/+$/, "");
  const [allLeads, pipeline, usersList, unsorted, kevEvents] = await Promise.all([
    amoCollection<AmoLead>(baseUrl, token, leadQueryPath(range), "leads"),
    amoRequest<{
      _embedded?: {
        statuses?: Array<{ id: number; name: string; sort: number }>;
      };
    }>(baseUrl, token, `/api/v4/leads/pipelines/${PIPELINE_ID}`),
    amoCollection<{ id: number; name: string }>(
      baseUrl,
      token,
      "/api/v4/users",
      "users",
    ),
    amoCollection<AmoUnsorted>(
      baseUrl,
      token,
      `/api/v4/leads/unsorted?filter[pipeline_id]=${PIPELINE_ID}`,
      "unsorted",
    ),
    amoCollection<AmoEvent>(
      baseUrl,
      token,
      kevEventQueryPath(range),
      "events",
      AMO_EVENT_PAGE_LIMIT,
    ),
  ]);

  const start = periodStartSeconds(range);
  const end = periodEndSeconds(range);
  const pipelineLeads = allLeads.filter(
    (lead) =>
      lead.pipeline_id === PIPELINE_ID &&
      lead.created_at >= start &&
      lead.created_at <= end,
  );
  const activeLeads = pipelineLeads.filter(
    (lead) => !CLOSED_STATUS_IDS.has(lead.status_id),
  );
  const currentUnsorted = unsorted.filter((item) => {
    const createdAt = Number(item.created_at ?? 0);
    return createdAt >= start && createdAt <= end;
  });
  const statusDefinitions = pipeline._embedded?.statuses ?? [];
  const stages = statusDefinitions
    .filter((status) => !CLOSED_STATUS_IDS.has(status.id))
    .map((status) => {
      const leads = activeLeads.filter((lead) => lead.status_id === status.id);
      return {
        id: status.id,
        name: status.name,
        count: leads.length,
        amount: leads.reduce((sum, lead) => sum + Number(lead.price ?? 0), 0),
        sort: status.sort,
      };
    })
    .sort((a, b) => a.sort - b.sort);

  const users = new Map(usersList.map((user) => [user.id, user.name]));
  const managerMap = new Map<number, ManagerSnapshot>();
  for (const lead of activeLeads) {
    const manager = ensureManager(
      managerMap,
      users,
      lead.responsible_user_id,
    );
    manager.total += 1;
    manager.stageCounts[String(lead.status_id)] =
      (manager.stageCounts[String(lead.status_id)] ?? 0) + 1;
  }

  const uniqueKev = uniqueKevEvents(kevEvents);
  const kevCount = uniqueKev.size;
  addKevPassedByManager(managerMap, users, activeLeads, uniqueKev);

  return {
    connected: true,
    sourceStatus: "live",
    statusMessage: "Данные обновлены",
    activeDeals: activeLeads.length,
    activeAmount: activeLeads.reduce(
      (sum, lead) => sum + Number(lead.price ?? 0),
      0,
    ),
    unsorted: currentUnsorted.length,
    stages,
    managers: [...managerMap.values()].sort((a, b) => b.total - a.total),
    // Новые лиды считаются по дате создания и не исчезают после закрытия сделки.
    trend: buildTrend(pipelineLeads, range),
    kevCount,
    kevByDate: kevCountsByDate(uniqueKev.values()),
    updatedAt: formatUpdatedAt(Date.now()),
  };
}

async function getStoredAmoDashboardData(
  db: D1Database,
  range: DashboardRange,
): Promise<AmoDashboardData | null> {
  const periodStart = periodStartSeconds(range);
  const periodEnd = periodEndSeconds(range);
  const [stageResult, statusResult, managerResult, userResult, createdResult, run, unsortedResult, kevResult] =
    await Promise.all([
      db.prepare(
        `SELECT CAST(json_extract(payload, '$.status_id') AS INTEGER) AS status_id,
                COUNT(*) AS count,
                COALESCE(SUM(CAST(json_extract(payload, '$.price') AS INTEGER)), 0) AS amount
         FROM integration_records
         WHERE source = 'amo' AND entity_type = 'leads'
           AND CAST(json_extract(payload, '$.pipeline_id') AS INTEGER) = ?
           AND CAST(json_extract(payload, '$.created_at') AS INTEGER) BETWEEN ? AND ?
           AND CAST(json_extract(payload, '$.status_id') AS INTEGER) NOT IN (142, 143)
         GROUP BY status_id`,
      ).bind(PIPELINE_ID, periodStart, periodEnd).all(),
      db.prepare(
        `SELECT payload FROM integration_records
         WHERE source = 'amo' AND entity_type = 'pipeline_statuses' AND scope = ?`,
      ).bind(String(PIPELINE_ID)).all(),
      db.prepare(
        `SELECT CAST(json_extract(payload, '$.responsible_user_id') AS INTEGER) AS user_id,
                CAST(json_extract(payload, '$.status_id') AS INTEGER) AS status_id,
                COUNT(*) AS count
         FROM integration_records
         WHERE source = 'amo' AND entity_type = 'leads'
           AND CAST(json_extract(payload, '$.pipeline_id') AS INTEGER) = ?
           AND CAST(json_extract(payload, '$.created_at') AS INTEGER) BETWEEN ? AND ?
           AND CAST(json_extract(payload, '$.status_id') AS INTEGER) NOT IN (142, 143)
         GROUP BY user_id, status_id`,
      ).bind(PIPELINE_ID, periodStart, periodEnd).all(),
      db.prepare(
        `SELECT payload FROM integration_records
         WHERE source = 'amo' AND entity_type = 'users'`,
      ).all(),
      db.prepare(
        `SELECT payload
         FROM integration_records
         WHERE source = 'amo' AND entity_type = 'leads'
           AND CAST(json_extract(payload, '$.pipeline_id') AS INTEGER) = ?
           AND CAST(json_extract(payload, '$.created_at') AS INTEGER) BETWEEN ? AND ?`,
      ).bind(PIPELINE_ID, periodStart, periodEnd).all(),
      db.prepare(
        `SELECT completed_at FROM integration_sync_runs
         WHERE source = 'amo' AND status IN ('completed', 'completed_with_errors')
         ORDER BY started_at DESC LIMIT 1`,
      ).first<{ completed_at: number | null }>(),
      db.prepare(
        `SELECT CAST(json_extract(payload, '$.created_at') AS INTEGER) AS created_at
         FROM integration_records
         WHERE source = 'amo' AND entity_type = 'unsorted'
           AND CAST(json_extract(payload, '$.pipeline_id') AS INTEGER) = ?
           AND CAST(json_extract(payload, '$.created_at') AS INTEGER) BETWEEN ? AND ?`,
      ).bind(PIPELINE_ID, periodStart, periodEnd).all(),
      db.prepare(
        `SELECT payload
         FROM integration_records
         WHERE source = 'amo' AND entity_type = 'events'
           AND json_extract(payload, '$.type') = 'lead_status_changed'
           AND CAST(json_extract(payload, '$.created_at') AS INTEGER) BETWEEN ? AND ?
           AND CAST(json_extract(payload, '$.value_after[0].lead_status.id') AS INTEGER) = ?
           AND CAST(json_extract(payload, '$.value_after[0].lead_status.pipeline_id') AS INTEGER) = ?`,
      ).bind(periodStart, periodEnd, KEV_STATUS_ID, PIPELINE_ID).all(),
    ]);

  if (!run?.completed_at && statusResult.results.length === 0) return null;

  const statusMap = new Map<number, { name: string; sort: number }>();
  for (const row of statusResult.results as Array<{ payload: string }>) {
    const status = JSON.parse(row.payload) as { id: number; name: string; sort: number };
    statusMap.set(status.id, { name: status.name, sort: status.sort });
  }
  const stageCounts = new Map(
    (stageResult.results as Array<{ status_id: number; count: number; amount: number }>).map(
      (row) => [row.status_id, { count: Number(row.count), amount: Number(row.amount) }],
    ),
  );
  const stages = [...statusMap.entries()]
    .filter(([statusId]) => !CLOSED_STATUS_IDS.has(statusId))
    .map(([id, definition]) => ({
      id,
      name: definition.name,
      count: stageCounts.get(id)?.count ?? 0,
      amount: stageCounts.get(id)?.amount ?? 0,
      sort: definition.sort,
    }))
    .sort((a, b) => a.sort - b.sort);

  const users = new Map<number, string>();
  for (const row of userResult.results as Array<{ payload: string }>) {
    const user = JSON.parse(row.payload) as { id: number; name: string };
    users.set(user.id, user.name);
  }
  const managerMap = new Map<number, ManagerSnapshot>();
  for (const row of managerResult.results as Array<{ user_id: number; status_id: number; count: number }>) {
    const manager = ensureManager(managerMap, users, row.user_id);
    manager.total += Number(row.count);
    manager.stageCounts[String(row.status_id)] = Number(row.count);
  }

  const storedKevEvents = (kevResult.results as Array<{ payload: string }>).map(
    (row) => JSON.parse(row.payload) as AmoEvent,
  );
  const uniqueKev = uniqueKevEvents(storedKevEvents);
  const kevCount = uniqueKev.size;
  const storedLeads = (createdResult.results as Array<{ payload: string }>).map(
    (row) => JSON.parse(row.payload) as AmoLead,
  );
  addKevPassedByManager(
    managerMap,
    users,
    storedLeads.filter((lead) => !CLOSED_STATUS_IDS.has(lead.status_id)),
    uniqueKev,
  );

  const leadsForTrend = storedLeads;
  return {
    connected: true,
    sourceStatus: "stored",
    statusMessage: "Показана последняя сохранённая копия",
    activeDeals: stages.reduce((sum, stage) => sum + stage.count, 0),
    activeAmount: stages.reduce((sum, stage) => sum + stage.amount, 0),
    unsorted: unsortedResult.results.length,
    stages,
    managers: [...managerMap.values()].sort((a, b) => b.total - a.total),
    trend: buildTrend(leadsForTrend, range),
    kevCount,
    kevByDate: kevCountsByDate(uniqueKev.values()),
    updatedAt: run?.completed_at ? formatUpdatedAt(run.completed_at) : "нет данных",
  };
}

export async function getAmoDashboardData(
  range: DashboardRange,
  forceRefresh = false,
): Promise<AmoDashboardData> {
  const runtime = env as unknown as AmoRuntime;
  const key = rangeKey(range);
  const cached = cache.get(key);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }
  const pending = inFlight.get(key);
  if (pending) return pending;

  const request = (async () => {
    if (runtime.AMO_BASE_URL && runtime.AMO_ACCESS_TOKEN) {
      try {
        const data = await getLiveAmoDashboardData(
          runtime.AMO_BASE_URL,
          runtime.AMO_ACCESS_TOKEN,
          range,
        );
        cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
        return data;
      } catch (error) {
        console.error(
          "amoCRM dashboard request failed:",
          error instanceof Error ? error.message : "Unknown error",
        );
        if (cached) {
          return {
            ...cached.data,
            sourceStatus: "cached" as const,
            statusMessage: "amoCRM временно недоступна — показаны последние данные",
          };
        }
      }
    }

    if (runtime.DB) {
      try {
        const stored = await getStoredAmoDashboardData(runtime.DB, range);
        if (stored) return stored;
      } catch (error) {
        console.error(
          "amoCRM stored dashboard request failed:",
          error instanceof Error ? error.message : "Unknown error",
        );
      }
    }

    return emptyAmoData(range, "Не удалось получить данные amoCRM");
  })();
  inFlight.set(key, request);
  try {
    return await request;
  } finally {
    inFlight.delete(key);
  }
}
