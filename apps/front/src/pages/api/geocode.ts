import type { APIRoute } from "astro";

import { searchLocationSuggestions } from "../../lib/geocoding";

export const prerender = false;

type GeocodeApiSuccess = {
  suggestions: Awaited<ReturnType<typeof searchLocationSuggestions>>;
};

type GeocodeApiError = GeocodeApiSuccess & {
  error: {
    code: string;
    message: string;
  };
};

function jsonResponse(payload: GeocodeApiSuccess | GeocodeApiError, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json",
    },
  });
}

export const GET: APIRoute = async ({ request, locals, url }) => {
  const query = url.searchParams.get("q")?.trim() ?? "";
  if (query.length < 2) {
    return jsonResponse({ suggestions: [] });
  }

  const requestedLimit = Number(url.searchParams.get("limit") ?? "5");
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(8, Math.max(1, Math.trunc(requestedLimit)))
    : 5;

  try {
    const suggestions = await searchLocationSuggestions(query, {
      locals,
      limit,
      acceptLanguage: request.headers.get("accept-language") ?? "pl-PL,pl;q=0.9",
    });

    return jsonResponse({ suggestions });
  } catch (error) {
    console.error("Failed to fetch location suggestions from Photon", error);

    return jsonResponse(
      {
        suggestions: [],
        error: {
          code: "geocoder_unavailable",
          message: "Lokalny geokoder jest chwilowo niedostepny.",
        },
      },
      503,
    );
  }
};
