import type { Config } from "@netlify/functions";

import { triggerBackgroundSync } from "../../lib/integrations/sync.ts";

export default async function handler(): Promise<Response> {
  await triggerBackgroundSync("all");
  return new Response(null, { status: 204 });
}

export const config: Config = {
  schedule: "@hourly",
};
