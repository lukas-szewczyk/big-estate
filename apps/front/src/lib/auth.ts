export type SessionUser = {
  id: number;
  email: string;
  role: "admin" | "user";
};

type RuntimeEnv = {
  API_SERVER_BASE_URL?: string;
  PUBLIC_API_BASE_URL?: string;
};

function readEnvValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function runtimeEnv(locals: App.Locals | undefined): RuntimeEnv {
  const env = locals?.runtime?.env;
  if (!env || typeof env !== "object") {
    return {};
  }

  return {
    API_SERVER_BASE_URL: readEnvValue(
      (env as Record<string, unknown>).API_SERVER_BASE_URL,
    ),
    PUBLIC_API_BASE_URL: readEnvValue(
      (env as Record<string, unknown>).PUBLIC_API_BASE_URL,
    ),
  };
}

export function getPublicApiBaseUrl(locals?: App.Locals): string {
  const runtimeValue = runtimeEnv(locals).PUBLIC_API_BASE_URL;
  const buildValue = readEnvValue(import.meta.env.PUBLIC_API_BASE_URL);
  return trimTrailingSlash(
    runtimeValue ?? buildValue ?? "http://localhost:3000",
  );
}

export function getServerApiBaseUrl(locals?: App.Locals): string {
  const runtimeValue = runtimeEnv(locals).API_SERVER_BASE_URL;
  return trimTrailingSlash(runtimeValue ?? getPublicApiBaseUrl(locals));
}

export async function getSessionUser(
  request: Request,
  locals?: App.Locals,
): Promise<SessionUser | null> {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) {
    return null;
  }

  let response: Response;
  try {
    response = await fetch(`${getServerApiBaseUrl(locals)}/auth/me`, {
      headers: {
        accept: "application/json",
        cookie: cookieHeader,
      },
    });
  } catch (error) {
    console.error("Failed to reach auth backend", error);
    throw new Error("Authentication backend is unavailable");
  }

  if (response.status === 401) {
    return null;
  }

  if (!response.ok) {
    const message = await response.text();
    throw new Error(
      `Authentication lookup failed: ${response.status} ${message}`,
    );
  }

  return (await response.json()) as SessionUser;
}
