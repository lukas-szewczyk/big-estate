type RuntimeEnv = {
  GEOCODER_BASE_URL?: string;
};

type PhotonFeature = {
  geometry?: {
    type?: string;
    coordinates?: unknown;
  };
  properties?: {
    countrycode?: unknown;
    country?: unknown;
    name?: unknown;
    street?: unknown;
    locality?: unknown;
    district?: unknown;
    city?: unknown;
    state?: unknown;
    type?: unknown;
    osm_value?: unknown;
    extent?: unknown;
  };
};

type PhotonResponse = {
  features?: PhotonFeature[];
};

export type GeocodeSuggestion = {
  label: string;
  lat: number;
  lon: number;
  bbox: string;
  kind: string;
};

const DEFAULT_GEOCODER_BASE_URL = "http://localhost:2322";
const DEFAULT_FALLBACK_DELTA = 0.02;

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
    GEOCODER_BASE_URL: readEnvValue(
      (env as Record<string, unknown>).GEOCODER_BASE_URL,
    ),
  };
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampLongitude(value: number): number {
  return clamp(value, -180, 180);
}

function clampLatitude(value: number): number {
  return clamp(value, -90, 90);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function formatCoordinate(value: number): string {
  return value.toFixed(6).replace(/\.?0+$/, "");
}

export function formatBbox(bounds: [number, number, number, number]): string {
  return bounds.map((value) => formatCoordinate(value)).join(",");
}

export function parseBbox(raw: string | null | undefined): [
  number,
  number,
  number,
  number,
] | null {
  if (!raw) {
    return null;
  }

  const parts = raw.split(",").map((value) => Number(value.trim()));
  if (
    parts.length !== 4 ||
    parts.some((value) => !Number.isFinite(value)) ||
    parts[0] < -180 ||
    parts[0] > 180 ||
    parts[2] < -180 ||
    parts[2] > 180 ||
    parts[1] < -90 ||
    parts[1] > 90 ||
    parts[3] < -90 ||
    parts[3] > 90
  ) {
    return null;
  }

  const west = Math.min(parts[0], parts[2]);
  const east = Math.max(parts[0], parts[2]);
  const south = Math.min(parts[1], parts[3]);
  const north = Math.max(parts[1], parts[3]);

  if (west >= east || south >= north) {
    return null;
  }

  return [west, south, east, north];
}

function bboxFromPoint(lon: number, lat: number): string {
  const west = clampLongitude(lon - DEFAULT_FALLBACK_DELTA);
  const east = clampLongitude(lon + DEFAULT_FALLBACK_DELTA);
  const south = clampLatitude(lat - DEFAULT_FALLBACK_DELTA);
  const north = clampLatitude(lat + DEFAULT_FALLBACK_DELTA);
  return formatBbox([west, south, east, north]);
}

function bboxFromExtent(extent: unknown): string | null {
  if (!Array.isArray(extent) || extent.length !== 4) {
    return null;
  }

  const [first, second, third, fourth] = extent.map((value) => Number(value));
  if (
    !Number.isFinite(first) ||
    !Number.isFinite(second) ||
    !Number.isFinite(third) ||
    !Number.isFinite(fourth)
  ) {
    return null;
  }

  return (
    formatBbox([
      Math.min(first, third),
      Math.min(second, fourth),
      Math.max(first, third),
      Math.max(second, fourth),
    ]) ?? null
  );
}

function dedupeLabelParts(parts: Array<string | null>): string[] {
  const uniqueParts: string[] = [];
  const seen = new Set<string>();

  for (const part of parts) {
    if (!part) {
      continue;
    }

    const key = part.toLocaleLowerCase("pl-PL");
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    uniqueParts.push(part);
  }

  return uniqueParts;
}

function buildSuggestionLabel(feature: PhotonFeature): string | null {
  const properties = feature.properties;
  if (!properties) {
    return null;
  }

  const parts = dedupeLabelParts([
    normalizeText(properties.name),
    normalizeText(properties.street),
    normalizeText(properties.locality),
    normalizeText(properties.district),
    normalizeText(properties.city),
    normalizeText(properties.state),
    normalizeText(properties.country),
  ]);

  return parts.length > 0 ? parts.join(", ") : null;
}

function normalizeSuggestion(feature: PhotonFeature): GeocodeSuggestion | null {
  if (feature.geometry?.type !== "Point") {
    return null;
  }

  const coordinates = feature.geometry.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) {
    return null;
  }

  const lon = Number(coordinates[0]);
  const lat = Number(coordinates[1]);
  if (!isFiniteNumber(lon) || !isFiniteNumber(lat)) {
    return null;
  }

  const properties = feature.properties;
  const countryCode = normalizeText(properties?.countrycode)?.toUpperCase();
  if (countryCode !== "PL") {
    return null;
  }

  const label = buildSuggestionLabel(feature);
  if (!label) {
    return null;
  }

  const bbox = bboxFromExtent(properties?.extent) ?? bboxFromPoint(lon, lat);

  return {
    label,
    lat,
    lon,
    bbox,
    kind:
      normalizeText(properties?.type) ??
      normalizeText(properties?.osm_value) ??
      "other",
  };
}

export function getGeocoderBaseUrl(locals?: App.Locals): string {
  const runtimeValue = runtimeEnv(locals).GEOCODER_BASE_URL;
  const buildValue = readEnvValue(import.meta.env.GEOCODER_BASE_URL);
  const processValue = readEnvValue(process.env.GEOCODER_BASE_URL);

  return trimTrailingSlash(
    runtimeValue ?? buildValue ?? processValue ?? DEFAULT_GEOCODER_BASE_URL,
  );
}

export async function searchLocationSuggestions(
  query: string,
  options: {
    locals?: App.Locals;
    limit?: number;
    signal?: AbortSignal;
    acceptLanguage?: string;
  } = {},
): Promise<GeocodeSuggestion[]> {
  const sanitizedQuery = query.trim();
  if (sanitizedQuery.length < 2) {
    return [];
  }

  const limit = clamp(Math.trunc(options.limit ?? 5), 1, 8);
  const url = new URL(`${getGeocoderBaseUrl(options.locals)}/api`);
  url.searchParams.set("q", sanitizedQuery);
  url.searchParams.set("limit", String(limit));

  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "accept-language": options.acceptLanguage ?? "pl-PL,pl;q=0.9",
    },
    signal: options.signal,
  });

  if (!response.ok) {
    throw new Error(`Photon geocoder request failed with ${response.status}`);
  }

  const payload = (await response.json()) as PhotonResponse;
  const rawFeatures = Array.isArray(payload.features) ? payload.features : [];
  const suggestions: GeocodeSuggestion[] = [];
  const seen = new Set<string>();

  for (const feature of rawFeatures) {
    const suggestion = normalizeSuggestion(feature);
    if (!suggestion) {
      continue;
    }

    const key = `${suggestion.label}:${suggestion.bbox}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    suggestions.push(suggestion);
  }

  return suggestions.slice(0, limit);
}
