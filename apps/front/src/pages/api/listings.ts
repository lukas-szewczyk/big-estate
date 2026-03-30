import type { APIRoute } from "astro";

import { getPostgresPool } from "../../lib/server/postgres";

export const prerender = false;

type ListingFeatureCollection = {
  type: "FeatureCollection";
  features: unknown[];
};

const EMPTY_FEATURE_COLLECTION: ListingFeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

function parseBboxParam(raw: string | null): string | null {
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
    parts[3] > 90 ||
    parts[0] >= parts[2] ||
    parts[1] >= parts[3]
  ) {
    return null;
  }

  return parts.join(",");
}

export const GET: APIRoute = async ({ locals, url }) => {
  const bbox = parseBboxParam(url.searchParams.get("bbox"));
  if (!bbox) {
    return new Response(
      JSON.stringify({
        error: {
          code: "invalid_bbox",
          message:
            "bbox must contain four numbers: minLng,minLat,maxLng,maxLat",
        },
      }),
      {
        status: 400,
        headers: {
          "cache-control": "no-store",
          "content-type": "application/json",
        },
      },
    );
  }

  const [minLng, minLat, maxLng, maxLat] = bbox
    .split(",")
    .map((value) => Number(value));

  try {
    const pool = getPostgresPool(locals);
    const result = await pool.query<{ geojson: ListingFeatureCollection }>(
      `
        WITH matching_listings AS (
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
            loc.coordinates::geometry AS geometry,
            COALESCE(primary_media.url, '/listing-placeholder.svg') AS thumbnail_url
          FROM listings AS l
          INNER JOIN properties AS p ON p.id = l.property_id
          INNER JOIN categories AS c ON c.id = p.category_id
          INNER JOIN locations AS loc ON loc.id = p.location_id
          INNER JOIN cities AS city ON city.id = loc.city_id
          LEFT JOIN LATERAL (
            SELECT url
            FROM media
            WHERE listing_id = l.id
              AND media_type = 'photo'
            ORDER BY is_main DESC, sort_order ASC, id ASC
            LIMIT 1
          ) AS primary_media ON TRUE
          WHERE l.status = 'active'
            AND ST_Intersects(
              loc.coordinates::geometry,
              ST_MakeEnvelope($1, $2, $3, $4, 4326)
            )
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
                  thumbnail_url,
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
      [minLng, minLat, maxLng, maxLat],
    );
    const geojson = result.rows[0]?.geojson ?? EMPTY_FEATURE_COLLECTION;

    return new Response(JSON.stringify(geojson), {
      status: 200,
      headers: {
        "cache-control": "no-store",
        "content-type": "application/geo+json",
      },
    });
  } catch (error) {
    console.error("Failed to query listing GeoJSON from PostgreSQL", error);

    return new Response(
      JSON.stringify({
        error: {
          code: "listings_query_failed",
          message: "Listing search is temporarily unavailable",
        },
      }),
      {
        status: 500,
        headers: {
          "cache-control": "no-store",
          "content-type": "application/json",
        },
      },
    );
  }
};
