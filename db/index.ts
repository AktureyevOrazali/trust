import { drizzle } from "drizzle-orm/netlify-db";

function createDatabase() {
  return drizzle();
}

type NetlifyDatabase = ReturnType<typeof createDatabase>;

let database: NetlifyDatabase | undefined;

export function getDb(): NetlifyDatabase {
  database ??= createDatabase();
  return database;
}

export const db = new Proxy({} as NetlifyDatabase, {
  get(_target, property) {
    const value = Reflect.get(getDb(), property);
    return typeof value === "function" ? value.bind(getDb()) : value;
  },
});

export type Database = NetlifyDatabase;
