import { Pool } from "pg";
import type { PoolConfig } from "pg";

type RuntimeEnv = {
  DATABASE_URL?: string;
  HYPERDRIVE?: Hyperdrive;
};

type PoolCache = {
  cacheKey: string;
  pool: Pool;
};

type ConnectionConfig = {
  connectionString: string;
  ssl?: PoolConfig["ssl"];
};

declare global {
  // Reuse the same pool across Astro dev reloads.
  var __frontPgPoolCache: PoolCache | undefined;
}

function readEnvValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function runtimeEnv(locals?: App.Locals): RuntimeEnv {
  const env = locals?.runtime?.env;
  if (!env || typeof env !== "object") {
    return {};
  }

  const runtime = env as Record<string, unknown>;

  return {
    DATABASE_URL: readEnvValue(runtime.DATABASE_URL),
    HYPERDRIVE:
      "HYPERDRIVE" in runtime ? (runtime.HYPERDRIVE as Hyperdrive) : undefined,
  };
}

function resolveSslConfig(connectionString: string): PoolConfig["ssl"] {
  const url = new URL(connectionString);
  const sslmode = url.searchParams.get("sslmode")?.toLowerCase();

  if (sslmode === "disable") {
    return undefined;
  }

  if (
    sslmode === "require" ||
    sslmode === "prefer" ||
    sslmode === "allow" ||
    sslmode === "verify-ca" ||
    sslmode === "verify-full"
  ) {
    return { rejectUnauthorized: false };
  }

  const isLocalHost =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "::1";

  if (!isLocalHost || url.port === "6432") {
    return { rejectUnauthorized: false };
  }

  return undefined;
}

function resolveConnectionConfig(locals?: App.Locals): ConnectionConfig | null {
  const env = runtimeEnv(locals);
  const buildEnvConnectionString = readEnvValue(
    (import.meta as ImportMeta & { env?: ImportMetaEnv }).env?.DATABASE_URL,
  );

  if (env.HYPERDRIVE?.connectionString) {
    return {
      connectionString: env.HYPERDRIVE.connectionString,
    };
  }

  const connectionString =
    env.DATABASE_URL ??
    buildEnvConnectionString ??
    readEnvValue(process.env.DATABASE_URL);

  if (!connectionString) {
    return null;
  }

  return {
    connectionString,
    ssl: resolveSslConfig(connectionString),
  };
}

function buildCacheKey(config: ConnectionConfig): string {
  return `${config.connectionString}::${config.ssl ? "ssl" : "plain"}`;
}

export function getPostgresPool(locals?: App.Locals): Pool {
  const config = resolveConnectionConfig(locals);

  if (!config) {
    throw new Error(
      "DATABASE_URL or a Hyperdrive binding is required to query listings",
    );
  }

  const { connectionString, ssl } = config;
  const cacheKey = buildCacheKey(config);
  const cache = globalThis.__frontPgPoolCache;
  if (cache && cache.cacheKey === cacheKey) {
    return cache.pool;
  }

  if (cache) {
    void cache.pool.end().catch((error: unknown) => {
      console.warn("Failed to close stale PostgreSQL pool", error);
    });
  }

  const pool = new Pool({
    connectionString,
    allowExitOnIdle: true,
    max: 5,
    ssl,
  });

  globalThis.__frontPgPoolCache = {
    cacheKey,
    pool,
  };

  return pool;
}
