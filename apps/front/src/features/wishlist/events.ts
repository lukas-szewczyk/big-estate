import type { GuestWishlist, Wishlist } from "./model";

export type WishlistChangedDetail = {
  mode: "guest" | "user";
  savedListingIds: number[];
  wishlists: Wishlist[];
  guestWishlist: GuestWishlist | null;
};

export const WISHLIST_CHANGED_EVENT = "wishlist:changed";

export function emitWishlistChanged(detail: WishlistChangedDetail) {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent(WISHLIST_CHANGED_EVENT, { detail }));
}

export function subscribeWishlistChanged(
  listener: (detail: WishlistChangedDetail) => void,
) {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handle = (event: Event) => {
    if (!(event instanceof CustomEvent)) {
      return;
    }

    listener(event.detail as WishlistChangedDetail);
  };

  window.addEventListener(WISHLIST_CHANGED_EVENT, handle);
  return () => window.removeEventListener(WISHLIST_CHANGED_EVENT, handle);
}
