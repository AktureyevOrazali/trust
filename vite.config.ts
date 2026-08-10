import vinext from "vinext";
import { defineConfig, loadEnv } from "vite";
import hostingConfig from "./.openai/hosting.json";
import { sites } from "./build/sites-vite-plugin";

const DEPLOYED_D1_DATABASE_ID =
  "1e7c9046-68b9-4ce8-80f1-b5ca792d8123";

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "site-creator-d1",
          database_id: DEPLOYED_D1_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
};

export default defineConfig(async ({ mode }) => {
  const runtimeEnv = loadEnv(mode, process.cwd(), "");
  const d1DatabaseId =
    runtimeEnv.CLOUDFLARE_D1_DATABASE_ID ??
    DEPLOYED_D1_DATABASE_ID;
  const d1DatabaseName =
    runtimeEnv.CLOUDFLARE_D1_DATABASE_NAME ?? "rnp-dashboard";
  const deploymentBindingConfig = {
    ...localBindingConfig,
    d1_databases: d1
      ? [
          {
            binding: d1,
            database_name: d1DatabaseName,
            database_id: d1DatabaseId,
            migrations_dir: "drizzle",
          },
        ]
      : [],
  };
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: deploymentBindingConfig,
      }),
    ],
  };
});
