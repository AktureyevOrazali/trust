import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("uses the standard Next.js runtime without Cloudflare packages", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));

  assert.equal(packageJson.scripts.dev, "next dev");
  assert.equal(packageJson.scripts.build, "next build");
  assert.equal(packageJson.scripts.start, "next start");
  assert.equal(packageJson.dependencies?.vinext, undefined);
  assert.equal(packageJson.devDependencies?.vinext, undefined);
  assert.equal(packageJson.devDependencies?.wrangler, undefined);
  assert.equal(packageJson.devDependencies?.["@cloudflare/vite-plugin"], undefined);
});

test("server modules do not depend on Cloudflare globals", async () => {
  const paths = [
    "lib/dashboard/amo.ts",
    "lib/dashboard/alfa.ts",
    "lib/dashboard/plan.ts",
    "lib/integrations/storage.ts",
    "app/api/integrations/sync/route.ts",
    "app/api/integrations/summary/route.ts",
  ];
  const source = (
    await Promise.all(paths.map((path) => readFile(path, "utf8")))
  ).join("\n");

  assert.doesNotMatch(source, /cloudflare:workers|D1Database/);
});

test("database module can be imported during builds without a connection", () => {
  const env = { ...process.env };
  delete env.NETLIFY_DB_URL;
  const output = execFileSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--input-type=module",
      "--eval",
      "await import('./db/index.ts'); console.log('imported')",
    ],
    { cwd: process.cwd(), encoding: "utf8", env },
  );

  assert.match(output, /imported/);
});
