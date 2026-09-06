import { Pool } from "pg";
import { createApp } from "./app.ts";
import { createAuthHandlers } from "./auth.ts";
import { GymRepository } from "./repository.ts";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} 설정이 필요합니다. .env.example을 확인하세요.`);
  return value;
}

/** Shared API setup; entrypoints own the HTTP server and pool lifecycle. */
export function createRuntime({
  production,
  port = 5173,
}: {
  production: boolean;
  port?: number;
}) {
  const appOrigin = new URL(
    production
      ? requiredEnv("APP_ORIGIN")
      : (process.env.APP_ORIGIN ?? `http://localhost:${port}`),
  ).origin;
  if (production && !appOrigin.startsWith("https://")) {
    throw new Error("배포 시 APP_ORIGIN을 실제 HTTPS 주소로 설정하세요.");
  }

  const auth = createAuthHandlers({
    baseUrl: requiredEnv("NEON_AUTH_BASE_URL"),
    cookieSecret: requiredEnv("NEON_AUTH_COOKIE_SECRET"),
    appOrigin,
  });
  const pool = new Pool({
    connectionString: requiredEnv("DATABASE_URL"),
    max: 5,
    idleTimeoutMillis: production ? 5_000 : 30_000,
    connectionTimeoutMillis: 15_000,
    statement_timeout: 20_000,
  });
  pool.on("error", () => console.error("An idle database connection failed."));
  const app = createApp({
    repository: new GymRepository(pool),
    auth,
    appOrigin,
  });
  return { app, pool, appOrigin };
}
