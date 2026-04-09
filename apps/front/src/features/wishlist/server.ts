import type { Wishlist } from "./model";

import { getServerApiBaseUrl } from "../../lib/auth";

export async function fetchWishlists(
  request: Request,
  locals?: App.Locals,
): Promise<Wishlist[]> {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) {
    return [];
  }

  const response = await fetch(`${getServerApiBaseUrl(locals)}/api/v1/wishlists`, {
    headers: {
      accept: "application/json",
      cookie: cookieHeader,
    },
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Wishlist lookup failed: ${response.status} ${message}`);
  }

  const payload = (await response.json()) as { items: Wishlist[] };
  return payload.items ?? [];
}
