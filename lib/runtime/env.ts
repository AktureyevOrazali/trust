export interface ServerEnv {
  syncSecret?: string;
  amoBaseUrl?: string;
  amoAccessToken?: string;
  alfaBaseUrl?: string;
  alfaEmail?: string;
  alfaApiKey?: string;
  alfaBranchIds: string[];
  siteUrl: string;
}

export function serverEnv(): ServerEnv {
  return {
    syncSecret: process.env.SYNC_SECRET,
    amoBaseUrl: process.env.AMO_BASE_URL,
    amoAccessToken: process.env.AMO_ACCESS_TOKEN,
    alfaBaseUrl: process.env.ALFA_BASE_URL,
    alfaEmail: process.env.ALFA_EMAIL,
    alfaApiKey: process.env.ALFA_API_KEY,
    alfaBranchIds: (process.env.ALFA_BRANCH_IDS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    siteUrl: (process.env.URL ?? "http://localhost:3000").replace(/\/$/, ""),
  };
}
