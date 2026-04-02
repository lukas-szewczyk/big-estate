import {
  Client,
  Pool,
  type QueryConfig,
  type QueryResult,
  type QueryResultRow,
} from "pg";

type QueryValues = unknown[];
type QueryInput<I extends QueryValues> = string | QueryConfig<I>;
type TransportMode = "plain" | "ssl";
type SslStrategy = TransportMode | "prefer";

export type PostgresPool = {
  query: <
    R extends QueryResultRow = QueryResultRow,
    I extends QueryValues = QueryValues,
  >(
    queryTextOrConfig: QueryInput<I>,
    values?: I,
  ) => Promise<QueryResult<R>>;
};

type RuntimeEnv = {
  DATABASE_URL?: string;
  HYPERDRIVE?: Hyperdrive;
};

type GlobalWithPostgresState = typeof globalThis & {
  __frontPostgresModes__?: Map<string, TransportMode>;
  __frontPostgresPools__?: Map<string, Pool>;
};

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

  return {
    DATABASE_URL: readEnvValue((env as Record<string, unknown>).DATABASE_URL),
    HYPERDRIVE:
      "HYPERDRIVE" in (env as Record<string, unknown>)
        ? ((env as Record<string, unknown>).HYPERDRIVE as
            | Hyperdrive
            | undefined)
        : undefined,
  };
}

function resolveConnectionString(locals?: App.Locals): string {
  const env = runtimeEnv(locals);
  const connectionString =
    env.HYPERDRIVE?.connectionString ??
    env.DATABASE_URL ??
    readEnvValue(import.meta.env.DATABASE_URL) ??
    readEnvValue(process.env.DATABASE_URL);

  if (!connectionString) {
    throw new Error(
      "Missing PostgreSQL connection string. Set HYPERDRIVE or DATABASE_URL.",
    );
  }

  return connectionString;
}

function resolveSslStrategy(connectionString: string): SslStrategy {
  try {
    const sslmode = new URL(connectionString).searchParams
      .get("sslmode")
      ?.toLowerCase();

    if (sslmode === "disable") {
      return "plain";
    }

    if (sslmode && sslmode !== "allow" && sslmode !== "prefer") {
      return "ssl";
    }
  } catch {
    // Ignore malformed URLs and keep the default strategy.
  }

  return "prefer";
}

function isWorkerRuntime(locals?: App.Locals): boolean {
  return Boolean(locals?.runtime?.env);
}

function getPoolCache(): Map<string, Pool> {
  const globalWithState = globalThis as GlobalWithPostgresState;
  if (!globalWithState.__frontPostgresPools__) {
    globalWithState.__frontPostgresPools__ = new Map();
  }

  return globalWithState.__frontPostgresPools__;
}

function getModeCache(): Map<string, TransportMode> {
  const globalWithState = globalThis as GlobalWithPostgresState;
  if (!globalWithState.__frontPostgresModes__) {
    globalWithState.__frontPostgresModes__ = new Map();
  }

  return globalWithState.__frontPostgresModes__;
}

function createNodePool(
  connectionString: string,
  transportMode: TransportMode,
): Pool {
  const poolKey = `${transportMode}:${connectionString}`;
  const poolCache = getPoolCache();
  const existingPool = poolCache.get(poolKey);
  if (existingPool) {
    return existingPool;
  }

  const pool = new Pool({
    connectionString,
    allowExitOnIdle: true,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    max: 10,
    ssl:
      transportMode === "ssl" ? { rejectUnauthorized: false } : undefined,
  });

  pool.on("error", (error) => {
    console.error("Unexpected PostgreSQL pool error", error);
  });

  poolCache.set(poolKey, pool);
  return pool;
}

function getTransportModes(
  connectionString: string,
  sslStrategy: SslStrategy,
): TransportMode[] {
  if (sslStrategy === "plain" || sslStrategy === "ssl") {
    return [sslStrategy];
  }

  const cachedMode = getModeCache().get(connectionString);
  if (cachedMode === "plain") {
    return ["plain", "ssl"];
  }

  return ["ssl", "plain"];
}

function isTransportRetryable(
  error: unknown,
  transportMode: TransportMode,
): boolean {
  const message = String(
    error instanceof Error ? error.message : error,
  ).toLowerCase();

  if (transportMode === "ssl") {
    return (
      message.includes("does not support ssl") ||
      message.includes("server does not support ssl")
    );
  }

  return message.includes("ssl required");
}

async function queryWithWorkerClient<
  R extends QueryResultRow,
  I extends QueryValues,
>(
  connectionString: string,
  transportMode: TransportMode,
  queryTextOrConfig: QueryInput<I>,
  values?: I,
): Promise<QueryResult<R>> {
  const client = new Client({
    connectionString,
    ssl:
      transportMode === "ssl" ? { rejectUnauthorized: false } : undefined,
  });

  try {
    await client.connect();
    if (typeof values === "undefined") {
      return await client.query<R, I>(queryTextOrConfig);
    }

    return await client.query<R, I>(queryTextOrConfig, values as never);
  } finally {
    await client.end().catch((disconnectError) => {
      console.error("Failed to close PostgreSQL client", disconnectError);
    });
  }
}

async function queryWithNodePool<R extends QueryResultRow, I extends QueryValues>(
  connectionString: string,
  transportMode: TransportMode,
  queryTextOrConfig: QueryInput<I>,
  values?: I,
): Promise<QueryResult<R>> {
  const pool = createNodePool(connectionString, transportMode);
  if (typeof values === "undefined") {
    return await pool.query<R, I>(queryTextOrConfig);
  }

  return await pool.query<R, I>(queryTextOrConfig, values as never);
}

export function getPostgresPool(locals?: App.Locals): PostgresPool {
  const connectionString = resolveConnectionString(locals);
  const sslStrategy = resolveSslStrategy(connectionString);
  const runInWorker = isWorkerRuntime(locals);

  return {
    query: async <
      R extends QueryResultRow = QueryResultRow,
      I extends QueryValues = QueryValues,
    >(
      queryTextOrConfig: QueryInput<I>,
      values?: I,
    ): Promise<QueryResult<R>> => {
      const transportModes = getTransportModes(connectionString, sslStrategy);
      let lastError: unknown;

      for (let index = 0; index < transportModes.length; index += 1) {
        const transportMode = transportModes[index];

        try {
          const result: QueryResult<R> = runInWorker
            ? await queryWithWorkerClient<R, I>(
                connectionString,
                transportMode,
                queryTextOrConfig,
                values,
              )
            : await queryWithNodePool<R, I>(
                connectionString,
                transportMode,
                queryTextOrConfig,
                values,
              );

          if (sslStrategy === "prefer") {
            getModeCache().set(connectionString, transportMode);
          }

          return result;
        } catch (error) {
          lastError = error;

          const hasFallback = index < transportModes.length - 1;
          if (!hasFallback || !isTransportRetryable(error, transportMode)) {
            throw error;
          }
        }
      }

      throw lastError ?? new Error("PostgreSQL query failed");
    },
  };
}
