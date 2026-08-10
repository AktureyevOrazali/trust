import { RequestRateLimiter } from "./rate-limit";
import {
  type DiscoveryResult,
  externalIdOf,
  safeErrorMessage,
  updatedAtOf,
} from "./types";

export const AMO_ENTITY_CATALOG = [
  "account",
  "users",
  "pipelines",
  "pipeline_statuses",
  "leads",
  "contacts",
  "companies",
  "customers",
  "tasks",
  "events",
  "lead_notes",
  "contact_notes",
  "company_notes",
  "customer_notes",
  "lead_custom_fields",
  "contact_custom_fields",
  "company_custom_fields",
  "customer_custom_fields",
  "lead_tags",
  "contact_tags",
  "company_tags",
  "customer_tags",
  "loss_reasons",
  "sources",
  "catalogs",
  "catalog_elements",
  "unsorted",
] as const;

type AmoCollectionDefinition = {
  entityType: string;
  path: string;
  embeddedKey: string;
};

const COLLECTIONS: AmoCollectionDefinition[] = [
  { entityType: "users", path: "/api/v4/users", embeddedKey: "users" },
  {
    entityType: "pipelines",
    path: "/api/v4/leads/pipelines",
    embeddedKey: "pipelines",
  },
  {
    entityType: "leads",
    path: "/api/v4/leads?with=contacts,source,loss_reason",
    embeddedKey: "leads",
  },
  {
    entityType: "contacts",
    path: "/api/v4/contacts?with=leads",
    embeddedKey: "contacts",
  },
  {
    entityType: "companies",
    path: "/api/v4/companies?with=contacts,leads",
    embeddedKey: "companies",
  },
  {
    entityType: "customers",
    path: "/api/v4/customers?with=contacts",
    embeddedKey: "customers",
  },
  { entityType: "tasks", path: "/api/v4/tasks", embeddedKey: "tasks" },
  { entityType: "events", path: "/api/v4/events", embeddedKey: "events" },
  {
    entityType: "lead_notes",
    path: "/api/v4/leads/notes",
    embeddedKey: "notes",
  },
  {
    entityType: "contact_notes",
    path: "/api/v4/contacts/notes",
    embeddedKey: "notes",
  },
  {
    entityType: "company_notes",
    path: "/api/v4/companies/notes",
    embeddedKey: "notes",
  },
  {
    entityType: "customer_notes",
    path: "/api/v4/customers/notes",
    embeddedKey: "notes",
  },
  {
    entityType: "lead_custom_fields",
    path: "/api/v4/leads/custom_fields",
    embeddedKey: "custom_fields",
  },
  {
    entityType: "contact_custom_fields",
    path: "/api/v4/contacts/custom_fields",
    embeddedKey: "custom_fields",
  },
  {
    entityType: "company_custom_fields",
    path: "/api/v4/companies/custom_fields",
    embeddedKey: "custom_fields",
  },
  {
    entityType: "customer_custom_fields",
    path: "/api/v4/customers/custom_fields",
    embeddedKey: "custom_fields",
  },
  {
    entityType: "lead_tags",
    path: "/api/v4/leads/tags",
    embeddedKey: "tags",
  },
  {
    entityType: "contact_tags",
    path: "/api/v4/contacts/tags",
    embeddedKey: "tags",
  },
  {
    entityType: "company_tags",
    path: "/api/v4/companies/tags",
    embeddedKey: "tags",
  },
  {
    entityType: "customer_tags",
    path: "/api/v4/customers/tags",
    embeddedKey: "tags",
  },
  {
    entityType: "loss_reasons",
    path: "/api/v4/leads/loss_reasons",
    embeddedKey: "loss_reasons",
  },
  {
    entityType: "sources",
    path: "/api/v4/sources",
    embeddedKey: "sources",
  },
  {
    entityType: "catalogs",
    path: "/api/v4/catalogs",
    embeddedKey: "catalogs",
  },
  {
    entityType: "unsorted",
    path: "/api/v4/leads/unsorted",
    embeddedKey: "unsorted",
  },
];

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

export class AmoClient {
  private readonly baseUrl: string;
  private readonly limiter = new RequestRateLimiter(180);

  constructor(
    baseUrl: string,
    private readonly accessToken: string,
  ) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
  }

  private async request(pathOrUrl: string): Promise<unknown> {
    await this.limiter.wait();
    const url = pathOrUrl.startsWith("http")
      ? pathOrUrl
      : `${this.baseUrl}${pathOrUrl}`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        Accept: "application/json",
      },
    });

    if (response.status === 204) return null;
    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `amoCRM ${response.status} for ${new URL(url).pathname}: ${body.slice(0, 300)}`,
      );
    }

    return response.json();
  }

  private async collection(
    definition: AmoCollectionDefinition,
  ): Promise<unknown[]> {
    const items: unknown[] = [];
    let page = 1;

    while (true) {
      const url = new URL(`${this.baseUrl}${definition.path}`);
      url.searchParams.set("limit", "250");
      url.searchParams.set("page", String(page));
      const body = (await this.request(url.toString())) as
        | {
            _embedded?: Record<string, unknown>;
            _links?: { next?: { href?: string } };
          }
        | null;
      const pageItems = body?._embedded?.[definition.embeddedKey];
      const list = Array.isArray(pageItems) ? pageItems : [];
      items.push(...list);

      if (!body?._links?.next?.href || list.length === 0) break;
      page += 1;
    }

    return items;
  }

  async discoverAll(): Promise<DiscoveryResult> {
    const result: DiscoveryResult = { records: [], errors: [] };
    const addRecords = (
      entityType: string,
      payloads: unknown[],
      scope = "account",
    ) => {
      payloads.forEach((payload, index) => {
        result.records.push({
          source: "amo",
          scope,
          entityType,
          externalId: externalIdOf(payload, `${entityType}-${index}`),
          payload,
          sourceUpdatedAt: updatedAtOf(payload),
        });
      });
    };

    try {
      const account = await this.request(
        "/api/v4/account?with=amojo_id,amojo_rights,users_groups,task_types,version",
      );
      if (account) addRecords("account", [account]);
    } catch (error) {
      result.errors.push({
        source: "amo",
        scope: "account",
        entityType: "account",
        message: safeErrorMessage(error),
      });
    }

    for (const definition of COLLECTIONS) {
      try {
        const payloads = await this.collection(definition);
        addRecords(definition.entityType, payloads);

        if (definition.entityType === "pipelines") {
          for (const pipeline of payloads) {
            const model = pipeline as {
              id?: number;
              _embedded?: { statuses?: unknown[] };
            };
            if (model.id && Array.isArray(model._embedded?.statuses)) {
              addRecords(
                "pipeline_statuses",
                model._embedded.statuses,
                String(model.id),
              );
            }
          }
        }

        if (definition.entityType === "catalogs") {
          for (const catalog of payloads) {
            const catalogId = externalIdOf(catalog, "");
            if (!catalogId) continue;
            try {
              const elements = await this.collection({
                entityType: "catalog_elements",
                path: `/api/v4/catalogs/${catalogId}/elements`,
                embeddedKey: "elements",
              });
              addRecords("catalog_elements", elements, catalogId);
            } catch (error) {
              result.errors.push({
                source: "amo",
                scope: catalogId,
                entityType: "catalog_elements",
                message: safeErrorMessage(error),
              });
            }
          }
        }
      } catch (error) {
        result.errors.push({
          source: "amo",
          scope: "account",
          entityType: definition.entityType,
          message: safeErrorMessage(error),
        });
      }
    }

    return result;
  }
}
