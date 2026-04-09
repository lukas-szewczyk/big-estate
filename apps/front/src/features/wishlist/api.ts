import type { Wishlist, WishlistColor } from "./model";

type ApiErrorShape = {
  error?: {
    message?: string;
  };
};

export async function fetchWishlists(apiBaseUrl: string): Promise<Wishlist[]> {
  const response = await fetch(`${apiBaseUrl}/api/v1/wishlists`, {
    credentials: "include",
    headers: {
      accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(await extractApiError(response, "Nie udało się pobrać wishlist."));
  }

  const payload = (await response.json()) as { items: Wishlist[] };
  return payload.items ?? [];
}

export async function createWishlist(
  apiBaseUrl: string,
  payload: { name: string; color: WishlistColor; is_shared?: boolean },
) {
  const response = await fetch(`${apiBaseUrl}/api/v1/wishlists`, {
    method: "POST",
    credentials: "include",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(await extractApiError(response, "Nie udało się utworzyć wishlisty."));
  }

  return (await response.json()) as Wishlist;
}

export async function updateWishlist(
  apiBaseUrl: string,
  wishlistId: number,
  payload: Partial<Pick<Wishlist, "name" | "color" | "is_shared">>,
) {
  const response = await fetch(`${apiBaseUrl}/api/v1/wishlists/${wishlistId}`, {
    method: "PATCH",
    credentials: "include",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(await extractApiError(response, "Nie udało się zaktualizować wishlisty."));
  }

  return (await response.json()) as Wishlist;
}

export async function deleteWishlist(apiBaseUrl: string, wishlistId: number) {
  const response = await fetch(`${apiBaseUrl}/api/v1/wishlists/${wishlistId}`, {
    method: "DELETE",
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(await extractApiError(response, "Nie udało się usunąć wishlisty."));
  }
}

export async function addWishlistItem(
  apiBaseUrl: string,
  wishlistId: number,
  listingId: number,
  userNotes = "",
) {
  const response = await fetch(`${apiBaseUrl}/api/v1/wishlists/${wishlistId}/items`, {
    method: "POST",
    credentials: "include",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      listing_id: listingId,
      user_notes: userNotes,
    }),
  });

  if (!response.ok) {
    throw new Error(await extractApiError(response, "Nie udało się dodać oferty do wishlisty."));
  }
}

export async function removeWishlistItem(
  apiBaseUrl: string,
  wishlistId: number,
  itemId: number,
) {
  const response = await fetch(
    `${apiBaseUrl}/api/v1/wishlists/${wishlistId}/items/${itemId}`,
    {
      method: "DELETE",
      credentials: "include",
    },
  );

  if (!response.ok) {
    throw new Error(await extractApiError(response, "Nie udało się usunąć oferty z wishlisty."));
  }
}

export async function importGuestWishlist(
  apiBaseUrl: string,
  payload: {
    name: string;
    color: WishlistColor;
    listing_ids: number[];
  },
) {
  const response = await fetch(`${apiBaseUrl}/api/v1/wishlists/import-guest`, {
    method: "POST",
    credentials: "include",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(
      await extractApiError(
        response,
        "Zalogowano, ale nie udało się przenieść wishlisty gościa.",
      ),
    );
  }
}

async function extractApiError(response: Response, fallback: string) {
  try {
    const payload = (await response.json()) as ApiErrorShape;
    if (payload?.error?.message) {
      return payload.error.message;
    }
  } catch {
    // ignore
  }

  return fallback;
}
