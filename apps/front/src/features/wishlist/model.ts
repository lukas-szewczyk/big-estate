export const WISHLIST_COLOR_OPTIONS = [
  "sand",
  "amber",
  "rose",
  "plum",
  "sky",
  "teal",
  "sage",
  "slate",
] as const;

export type WishlistColor = (typeof WISHLIST_COLOR_OPTIONS)[number];

export type WishlistListingSummary = {
  id: number;
  slug: string;
  title: string;
  price: number;
  transaction_type: string;
  status: string;
  city: string;
  street: string;
  rooms: number;
  thumbnail_url: string;
};

export type WishlistItem = {
  id: number;
  listing_id: number;
  added_at: string;
  user_notes: string;
  listing: WishlistListingSummary;
};

export type Wishlist = {
  id: number;
  user_id: number;
  name: string;
  color: WishlistColor;
  is_shared: boolean;
  created_at: string;
  items: WishlistItem[];
};

export type GuestWishlist = {
  name: "niezalogowany";
  color: WishlistColor;
  listingIds: number[];
  listingsById?: Record<string, WishlistListingSummary>;
  updatedAt?: string;
};

export const GUEST_WISHLIST_STORAGE_KEY = "guest_wishlist_v1";

export const WISHLIST_COLOR_META: Record<
  WishlistColor,
  { label: string; accent: string; surface: string; border: string }
> = {
  sand: {
    label: "Piaskowy",
    accent: "#8a6a4c",
    surface: "#f1e5d7",
    border: "#d7c2ad",
  },
  amber: {
    label: "Bursztyn",
    accent: "#a86b1f",
    surface: "#f7e1bf",
    border: "#e7c792",
  },
  rose: {
    label: "Róż",
    accent: "#b45c71",
    surface: "#f5dde4",
    border: "#e7bdca",
  },
  plum: {
    label: "Śliwka",
    accent: "#78518a",
    surface: "#eadff0",
    border: "#cfbfd9",
  },
  sky: {
    label: "Błękit",
    accent: "#4e83b8",
    surface: "#ddebf7",
    border: "#bdd3ea",
  },
  teal: {
    label: "Morski",
    accent: "#2f7d78",
    surface: "#d9efec",
    border: "#afd8d3",
  },
  sage: {
    label: "Szałwia",
    accent: "#5d7b62",
    surface: "#e3eee1",
    border: "#c7d8c4",
  },
  slate: {
    label: "Łupek",
    accent: "#586579",
    surface: "#e0e6ef",
    border: "#c1cbd9",
  },
};

export function nowIso() {
  return new Date().toISOString();
}

export function isWishlistColor(value: unknown): value is WishlistColor {
  return typeof value === "string" && WISHLIST_COLOR_OPTIONS.includes(value as WishlistColor);
}

export function createDefaultGuestWishlist(): GuestWishlist {
  return {
    name: "niezalogowany",
    color: "sand",
    listingIds: [],
    listingsById: {},
    updatedAt: nowIso(),
  };
}

export function createGuestWishlistFallbackListing(
  listingId: number,
): WishlistListingSummary {
  return {
    id: listingId,
    slug: "",
    title: "Oferta z wishlisty",
    price: 0,
    transaction_type: "sale",
    status: "active",
    city: "Polska",
    street: "Adres niedostępny",
    rooms: 0,
    thumbnail_url: "/listing-placeholder.svg",
  };
}

export function guestWishlistToWishlist(guestWishlist: GuestWishlist): Wishlist {
  const items: WishlistItem[] = guestWishlist.listingIds.map((listingId, index) => ({
    id: -(index + 1),
    listing_id: listingId,
    added_at: guestWishlist.updatedAt ?? nowIso(),
    user_notes: "",
    listing:
      guestWishlist.listingsById?.[String(listingId)] ??
      createGuestWishlistFallbackListing(listingId),
  }));

  return {
    id: -1,
    user_id: 0,
    name: "niezalogowany",
    color: guestWishlist.color,
    is_shared: false,
    created_at: guestWishlist.updatedAt ?? nowIso(),
    items,
  };
}

export function getSavedListingIdsFromWishlists(wishlists: Wishlist[]) {
  return Array.from(
    new Set(
      wishlists.flatMap((wishlist) =>
        wishlist.items.map((item) => item.listing_id),
      ),
    ),
  );
}

export function getSavedListingColorsFromWishlists(wishlists: Wishlist[]) {
  const colors = new Map<number, string>();

  for (const wishlist of wishlists) {
    for (const item of wishlist.items) {
      if (!colors.has(item.listing_id)) {
        colors.set(item.listing_id, WISHLIST_COLOR_META[wishlist.color].accent);
      }
    }
  }

  return colors;
}

export function dedupePositiveListingIds(listingIds: number[]) {
  const deduped: number[] = [];

  for (const listingId of listingIds) {
    if (Number.isInteger(listingId) && listingId > 0 && !deduped.includes(listingId)) {
      deduped.push(listingId);
    }
  }

  return deduped;
}
