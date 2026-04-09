import { GUEST_WISHLIST_STORAGE_KEY } from "./model";
import { emitWishlistChanged } from "./events";
import { importGuestWishlist } from "./api";
import { clearGuestWishlist, readGuestWishlist } from "./storage";

export async function importGuestWishlistAfterAuth(apiBaseUrl: string) {
  const guestWishlist = readGuestWishlist(GUEST_WISHLIST_STORAGE_KEY);
  if (guestWishlist.listingIds.length === 0) {
    return { imported: false, message: null as string | null };
  }

  try {
    await importGuestWishlist(apiBaseUrl, {
      name: guestWishlist.name,
      color: guestWishlist.color,
      listing_ids: guestWishlist.listingIds,
    });
  } catch (error) {
    return {
      imported: false,
      message:
        error instanceof Error
          ? error.message
          : "Zalogowano, ale nie udało się przenieść wishlisty gościa.",
    };
  }

  clearGuestWishlist(GUEST_WISHLIST_STORAGE_KEY);
  emitWishlistChanged({
    mode: "guest",
    savedListingIds: [],
    wishlists: [],
    guestWishlist: null,
  });

  return { imported: true, message: null as string | null };
}
