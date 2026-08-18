import type { AnalyticsFilters } from "./types.ts";

const FILTER_NAMES = ["branch", "teacher", "group", "status"] as const;

export class InvalidAnalyticsFilterError extends Error {}

export function parseAnalyticsFilters(search: URLSearchParams): AnalyticsFilters {
  const filters: AnalyticsFilters = {};

  for (const name of FILTER_NAMES) {
    const raw = search.get(name);
    if (raw == null) continue;
    const value = raw.trim();
    if (value.length > 120) {
      throw new InvalidAnalyticsFilterError(
        `Фильтр «${name}» не должен быть длиннее 120 символов`,
      );
    }
    if (value) filters[name] = value;
  }

  return filters;
}
