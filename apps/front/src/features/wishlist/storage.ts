import type { GuestWishlist, WishlistListingSummary } from "./model";
import {
  createDefaultGuestWishlist,
  dedupePositiveListingIds,
  isWishlistColor,
  nowIso,
} from "./model";

export function readGuestWishlist(storageKey: string): GuestWishlist {
  if (typeof window === "undefined") {
    return createDefaultGuestWishlist();
  }

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return createDefaultGuestWishlist();
    }

    const parsed = JSON.parse(raw) as Partial<GuestWishlist>;

    return {
      name: "niezalogowany",
      color: isWishlistColor(parsed.color) ? parsed.color : "sand",
      listingIds: dedupePositiveListingIds(
        Array.isArray(parsed.listingIds)
          ? parsed.listingIds.map((value) => Number(value))
          : [],
      ),
      listingsById:
        parsed.listingsById && typeof parsed.listingsById === "object"
          ? parsed.listingsById
          : {},
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : nowIso(),
    };
  } catch {
    return createDefaultGuestWishlist();
  }
}

export function writeGuestWishlist(storageKey: string, wishlist: GuestWishlist) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    storageKey,
    JSON.stringify({
      ...wishlist,
      listingIds: dedupePositiveListingIds(wishlist.listingIds),
      updatedAt: nowIso(),
    }),
  );
}

export function clearGuestWishlist(storageKey: string) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(storageKey);
}

export function guestWishlistHasListing(
  storageKey: string,
  listingId: number,
) {
  return readGuestWishlist(storageKey).listingIds.includes(listingId);
}

export function upsertGuestWishlistListing(
  storageKey: string,
  listing: WishlistListingSummary,
) {
  const wishlist = readGuestWishlist(storageKey);
  const nextWishlist: GuestWishlist = {
    ...wishlist,
    listingIds: wishlist.listingIds.includes(listing.id)
      ? wishlist.listingIds
      : [...wishlist.listingIds, listing.id],
    listingsById: {
      ...(wishlist.listingsById ?? {}),
      [String(listing.id)]: listing,
    },
    updatedAt: nowIso(),
  };

  writeGuestWishlist(storageKey, nextWishlist);
  return nextWishlist;
}

export function removeGuestWishlistListing(
  storageKey: string,
  listingId: number,
) {
  const wishlist = readGuestWishlist(storageKey);
  const nextListingsById = { ...(wishlist.listingsById ?? {}) };
  delete nextListingsById[String(listingId)];

  const nextWishlist: GuestWishlist = {
    ...wishlist,
    listingIds: wishlist.listingIds.filter((id) => id !== listingId),
    listingsById: nextListingsById,
    updatedAt: nowIso(),
  };

  writeGuestWishlist(storageKey, nextWishlist);
  return nextWishlist;
}
