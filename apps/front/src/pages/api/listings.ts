import type { APIRoute } from "astro";

import { getPostgresPool } from "../../lib/server/postgres";

export const prerender = false;

type ListingFeatureCollection = {
  type: "FeatureCollection";
  features: unknown[];
};

type Bbox = [number, number, number, number];
type Position = [number, number];

type PolygonGeometry = {
  type: "Polygon";
  coordinates: [Position[]];
};

type SearchShape =
  | {
      type: "bbox";
      bbox: Bbox;
    }
  | {
      type: "polygon";
      geometry: PolygonGeometry;
    };

type SearchFilters = {
  transactionType?: "sale" | "rent";
  categoryId?: number;
  minPrice?: number;
  maxPrice?: number;
  rooms?: number;
};

type SearchRequest = {
  shape: SearchShape;
  filters: SearchFilters;
};

type RawSearchPayload = {
  shape?: unknown;
  filters?: unknown;
  transaction_type?: unknown;
  category_id?: unknown;
  min_price?: unknown;
  max_price?: unknown;
  rooms?: unknown;
};

class SearchRequestError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const EMPTY_FEATURE_COLLECTION: ListingFeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

function jsonHeaders(contentType: string) {
  return {
    "cache-control": "no-store",
    "content-type": contentType,
  };
}

function errorResponse(
  status: number,
  code: string,
  message: string,
): Response {
  return new Response(
    JSON.stringify({
      error: {
        code,
        message,
      },
    }),
    {
      status,
      headers: jsonHeaders("application/json"),
    },
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseFiniteNumber(
  value: unknown,
  fieldName: string,
  {
    min,
    max,
    allowEmpty = false,
  }: { min?: number; max?: number; allowEmpty?: boolean } = {},
): number | undefined {
  if (value === undefined || value === null || (allowEmpty && value === "")) {
    return undefined;
  }

  const normalizedValue =
    typeof value === "string" ? value.trim().replace(/\s+/g, "") : value;
  if (allowEmpty && normalizedValue === "") {
    return undefined;
  }
  const parsed = Number(normalizedValue);

  if (!Number.isFinite(parsed)) {
    throw new SearchRequestError(
      400,
      "invalid_filters",
      `${fieldName} must be a finite number`,
    );
  }

  if (typeof min === "number" && parsed < min) {
    throw new SearchRequestError(
      400,
      "invalid_filters",
      `${fieldName} must be greater than or equal to ${min}`,
    );
  }

  if (typeof max === "number" && parsed > max) {
    throw new SearchRequestError(
      400,
      "invalid_filters",
      `${fieldName} must be less than or equal to ${max}`,
    );
  }

  return parsed;
}

function parseOptionalInteger(
  value: unknown,
  fieldName: string,
  {
    min = 1,
    allowEmpty = false,
  }: { min?: number; allowEmpty?: boolean } = {},
): number | undefined {
  const parsed = parseFiniteNumber(value, fieldName, { min, allowEmpty });
  if (parsed === undefined) {
    return undefined;
  }

  if (!Number.isInteger(parsed)) {
    throw new SearchRequestError(
      400,
      "invalid_filters",
      `${fieldName} must be an integer`,
    );
  }

  return parsed;
}

function parseBbox(values: unknown): Bbox {
  if (!Array.isArray(values) || values.length !== 4) {
    throw new SearchRequestError(
      400,
      "invalid_bbox",
      "bbox must contain four numbers: minLng,minLat,maxLng,maxLat",
    );
  }

  const bbox = values.map((value, index) =>
    parseFiniteNumber(value, `bbox[${index}]`, {
      min: index % 2 === 0 ? -180 : -90,
      max: index % 2 === 0 ? 180 : 90,
    }),
  ) as Bbox;

  if (bbox[0] >= bbox[2] || bbox[1] >= bbox[3]) {
    throw new SearchRequestError(
      400,
      "invalid_bbox",
      "bbox must satisfy minLng < maxLng and minLat < maxLat",
    );
  }

  return bbox;
}

function parseBboxParam(raw: string | null): Bbox {
  if (!raw) {
    throw new SearchRequestError(
      400,
      "invalid_bbox",
      "bbox must contain four numbers: minLng,minLat,maxLng,maxLat",
    );
  }

  return parseBbox(raw.split(",").map((value) => value.trim()));
}

function parsePosition(value: unknown, fieldName: string): Position {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new SearchRequestError(
      400,
      "invalid_polygon",
      `${fieldName} must contain [lng, lat] coordinates`,
    );
  }

  const lng = parseFiniteNumber(value[0], `${fieldName}[0]`, {
    min: -180,
    max: 180,
  });
  const lat = parseFiniteNumber(value[1], `${fieldName}[1]`, {
    min: -90,
    max: 90,
  });

  return [lng ?? 0, lat ?? 0];
}

function arePositionsEqual([lngA, latA]: Position, [lngB, latB]: Position) {
  return Math.abs(lngA - lngB) < 1e-9 && Math.abs(latA - latB) < 1e-9;
}

function normalizeRing(ring: Position[]): Position[] {
  const normalized: Position[] = [];

  for (const position of ring) {
    const previous = normalized[normalized.length - 1];
    if (!previous || !arePositionsEqual(previous, position)) {
      normalized.push(position);
    }
  }

  if (normalized.length < 3) {
    throw new SearchRequestError(
      400,
      "invalid_polygon",
      "polygon must contain at least three distinct points",
    );
  }

  const first = normalized[0];
  const last = normalized[normalized.length - 1];
  if (!arePositionsEqual(first, last)) {
    normalized.push(first);
  }

  if (normalized.length < 4) {
    throw new SearchRequestError(
      400,
      "invalid_polygon",
      "polygon ring must contain at least four positions",
    );
  }

  if (normalized.length > 2_000) {
    throw new SearchRequestError(
      400,
      "invalid_polygon",
      "polygon contains too many points",
    );
  }

  return normalized;
}

function parsePolygonGeometry(value: unknown): PolygonGeometry {
  if (!isObject(value) || value.type !== "Polygon" || !Array.isArray(value.coordinates)) {
    throw new SearchRequestError(
      400,
      "invalid_polygon",
      "shape.geometry must be a GeoJSON Polygon",
    );
  }

  if (value.coordinates.length !== 1) {
    throw new SearchRequestError(
      400,
      "invalid_polygon",
      "polygon must contain exactly one outer ring",
    );
  }

  const outerRing = value.coordinates[0];
  if (!Array.isArray(outerRing)) {
    throw new SearchRequestError(
      400,
      "invalid_polygon",
      "polygon outer ring must be an array of coordinates",
    );
  }

  const ring = normalizeRing(
    outerRing.map((position, index) => parsePosition(position, `coordinates[0][${index}]`)),
  );

  return {
    type: "Polygon",
    coordinates: [ring],
  };
}

function parseShape(value: unknown): SearchShape {
  if (!isObject(value) || typeof value.type !== "string") {
    throw new SearchRequestError(
      400,
      "invalid_shape",
      "shape must define a supported search area",
    );
  }

  if (value.type === "bbox") {
    return {
      type: "bbox",
      bbox: parseBbox(value.bbox),
    };
  }

  if (value.type === "polygon") {
    return {
      type: "polygon",
      geometry: parsePolygonGeometry(value.geometry),
    };
  }

  throw new SearchRequestError(
    400,
    "invalid_shape",
    "shape.type must be either bbox or polygon",
  );
}

function parseFilters(input: unknown): SearchFilters {
  const raw =
    isObject(input) && isObject(input.filters)
      ? input.filters
      : isObject(input)
        ? input
        : {};

  const transactionType =
    raw.transaction_type === undefined ||
    raw.transaction_type === null ||
    raw.transaction_type === ""
      ? undefined
      : String(raw.transaction_type);

  if (
    transactionType !== undefined &&
    transactionType !== "sale" &&
    transactionType !== "rent"
  ) {
    throw new SearchRequestError(
      400,
      "invalid_filters",
      "transaction_type must be one of: sale, rent",
    );
  }

  return {
    transactionType,
    categoryId: parseOptionalInteger(raw.category_id, "category_id", {
      allowEmpty: true,
    }),
    minPrice: parseFiniteNumber(raw.min_price, "min_price", {
      min: 0,
      allowEmpty: true,
    }),
    maxPrice: parseFiniteNumber(raw.max_price, "max_price", {
      min: 0,
      allowEmpty: true,
    }),
    rooms: parseOptionalInteger(raw.rooms, "rooms", {
      allowEmpty: true,
    }),
  };
}

function parseSearchPayload(payload: unknown): SearchRequest {
  if (!isObject(payload)) {
    throw new SearchRequestError(
      400,
      "invalid_body",
      "Request body must be a JSON object",
    );
  }

  return {
    shape: parseShape(payload.shape),
    filters: parseFilters(payload as RawSearchPayload),
  };
}

async function searchListings(
  locals: App.Locals,
  searchRequest: SearchRequest,
): Promise<Response> {
  const pool = getPostgresPool(locals);
  const params: unknown[] = [];

  const searchAreaSql =
    searchRequest.shape.type === "polygon"
      ? `ST_CollectionExtract(
           ST_MakeValid(
             ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)
           ),
           3
         )`
      : "ST_MakeEnvelope($1, $2, $3, $4, 4326)";

  if (searchRequest.shape.type === "polygon") {
    params.push(JSON.stringify(searchRequest.shape.geometry));
  } else {
    params.push(...searchRequest.shape.bbox);
  }

  const whereClauses = [
    "l.status = 'active'",
    "ST_Covers(search_area.geometry, loc.coordinates::geometry)",
  ];

  if (searchRequest.filters.transactionType) {
    params.push(searchRequest.filters.transactionType);
    whereClauses.push(`l.transaction_type = $${params.length}`);
  }

  if (typeof searchRequest.filters.categoryId === "number") {
    params.push(searchRequest.filters.categoryId);
    whereClauses.push(`p.category_id = $${params.length}`);
  }

  if (typeof searchRequest.filters.minPrice === "number") {
    params.push(searchRequest.filters.minPrice);
    whereClauses.push(`l.price >= $${params.length}::numeric`);
  }

  if (typeof searchRequest.filters.maxPrice === "number") {
    params.push(searchRequest.filters.maxPrice);
    whereClauses.push(`l.price <= $${params.length}::numeric`);
  }

  if (typeof searchRequest.filters.rooms === "number") {
    params.push(searchRequest.filters.rooms);
    whereClauses.push(`p.rooms = $${params.length}`);
  }

  const result = await pool.query<{ geojson: ListingFeatureCollection }>(
    `
      WITH search_area AS (
        SELECT ${searchAreaSql} AS geometry
      ),
      matching_listings AS (
        SELECT
          l.id,
          l.slug,
          l.transaction_type,
          l.price,
          l.updated_at,
          p.rooms,
          c.name AS category_name,
          city.name AS city_name,
          loc.street,
          loc.coordinates::geometry AS geometry
        FROM listings AS l
        INNER JOIN properties AS p ON p.id = l.property_id
        INNER JOIN categories AS c ON c.id = p.category_id
        INNER JOIN locations AS loc ON loc.id = p.location_id
        INNER JOIN cities AS city ON city.id = loc.city_id
        CROSS JOIN search_area
        WHERE ${whereClauses.join("\n          AND ")}
        ORDER BY l.updated_at DESC, l.id DESC
        LIMIT 500
      )
      SELECT jsonb_build_object(
        'type',
        'FeatureCollection',
        'features',
        COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'type',
              'Feature',
              'geometry',
              ST_AsGeoJSON(geometry)::jsonb,
              'properties',
              jsonb_build_object(
                'id',
                id,
                'slug',
                slug,
                'title',
                category_name || ' in ' || city_name,
                'price',
                price,
                'rooms',
                rooms,
                'transactionType',
                transaction_type,
                'thumbnailUrl',
                '/listing-placeholder.svg',
                'city',
                city_name,
                'street',
                street
              )
            )
            ORDER BY updated_at DESC, id DESC
          ),
          '[]'::jsonb
        )
      ) AS geojson
      FROM matching_listings
    `,
    params,
  );

  const geojson = result.rows[0]?.geojson ?? EMPTY_FEATURE_COLLECTION;

  return new Response(JSON.stringify(geojson), {
    status: 200,
    headers: jsonHeaders("application/geo+json"),
  });
}

export const GET: APIRoute = async ({ locals, url }) => {
  try {
    return await searchListings(locals, {
      shape: {
        type: "bbox",
        bbox: parseBboxParam(url.searchParams.get("bbox")),
      },
      filters: parseFilters({
        transaction_type: url.searchParams.get("transaction_type"),
        category_id: url.searchParams.get("category_id"),
        min_price: url.searchParams.get("min_price"),
        max_price: url.searchParams.get("max_price"),
        rooms: url.searchParams.get("rooms"),
      }),
    });
  } catch (error) {
    if (error instanceof SearchRequestError) {
      return errorResponse(error.status, error.code, error.message);
    }

    console.error("Failed to query listing GeoJSON from PostgreSQL", error);
    return errorResponse(
      500,
      "listings_query_failed",
      "Listing search is temporarily unavailable",
    );
  }
};

export const POST: APIRoute = async ({ locals, request }) => {
  try {
    const payload = parseSearchPayload(await request.json());
    return await searchListings(locals, payload);
  } catch (error) {
    if (error instanceof SearchRequestError) {
      return errorResponse(error.status, error.code, error.message);
    }

    if (error instanceof SyntaxError) {
      return errorResponse(
        400,
        "invalid_body",
        "Request body must contain valid JSON",
      );
    }

    console.error("Failed to query listing GeoJSON from PostgreSQL", error);
    return errorResponse(
      500,
      "listings_query_failed",
      "Listing search is temporarily unavailable",
    );
  }
};
