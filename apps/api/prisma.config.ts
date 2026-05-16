// Prisma config for apps/api.
// Load .env from apps/api/ first; fall back to repo root for legacy setups.
import { config } from "dotenv";
import { resolve } from "path";
import { defineConfig } from "prisma/config";

// When running via `npm --prefix apps/api`, cwd = apps/api.
// When running from repo root directly, cwd = repo root.
// We explicitly resolve relative to this config file to be location-agnostic.
config({ path: resolve(import.meta.dirname ?? __dirname, ".env") });
config({ path: resolve(import.meta.dirname ?? __dirname, "../../.env"), override: false });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
