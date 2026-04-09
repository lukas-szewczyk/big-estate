import type { Wishlist, WishlistColor, WishlistListingSummary } from "./model";
import { WISHLIST_COLOR_META } from "./model";

export type WishlistMapListingProperties = {
  id: number;
  slug: string;
  title: string;
  price: number;
  rooms: number;
  transactionType: string;
  thumbnailUrl: string;
  city: string;
  street: string;
  saved?: boolean;
  savedColor?: string;
};

export type WishlistMapFeature = {
  type: "Feature";
  geometry: {
    type: "Point";
    coordinates: [number, number];
  };
  properties: WishlistMapListingProperties;
};

export type WishlistMapFeatureCollection = {
  type: "FeatureCollection";
  features: WishlistMapFeature[];
};

export function getWishlistMarkerColors(wishlists: Wishlist[]) {
  const colors = new Map<number, string>();

  for (const wishlist of wishlists) {
    const accent = WISHLIST_COLOR_META[wishlist.color].accent;
    for (const item of wishlist.items) {
      if (!colors.has(item.listing_id)) {
        colors.set(item.listing_id, accent);
      }
    }
  }

  return colors;
}

export function applyWishlistStateToFeatures(
  collection: WishlistMapFeatureCollection,
  savedListingIds: Set<number>,
  savedListingColors: Map<number, string>,
): WishlistMapFeatureCollection {
  return {
    ...collection,
    features: collection.features.map((feature) => ({
      ...feature,
      properties: {
        ...feature.properties,
        saved: savedListingIds.has(feature.properties.id),
        savedColor: savedListingColors.get(feature.properties.id),
      },
    })),
  };
}

export function syncWishlistButtonState(
  element: HTMLElement,
  isSaved: boolean,
  savedColor?: string,
) {
  element.dataset.active = isSaved ? "true" : "false";
  element.style.backgroundColor = isSaved && savedColor ? savedColor : "";
  element.style.borderColor = isSaved && savedColor ? savedColor : "";
  element.style.color = isSaved ? "#ffffff" : "";
  element.setAttribute(
    "aria-label",
    isSaved ? "Usuń ofertę z wishlisty" : "Dodaj ofertę do wishlisty",
  );
}

export function createWishlistPriceMarker(
  properties: WishlistMapListingProperties,
  label: string,
  onClick: () => void,
) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "listing-map__price-marker";
  button.dataset.saved = properties.saved ? "true" : "false";
  button.dataset.listingId = String(properties.id);
  button.setAttribute("aria-label", `${properties.title}, ${label}`);
  button.textContent = label;

  if (properties.saved && properties.savedColor) {
    button.style.backgroundColor = properties.savedColor;
    button.style.borderColor = properties.savedColor;
    button.style.color = "#ffffff";
  }

  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });

  return button;
}

export function toWishlistListingSummary(
  properties: WishlistMapListingProperties,
): WishlistListingSummary {
  return {
    id: properties.id,
    slug: properties.slug,
    title: properties.title,
    price: properties.price,
    transaction_type: properties.transactionType,
    status: "active",
    city: properties.city,
    street: properties.street,
    rooms: properties.rooms,
    thumbnail_url: properties.thumbnailUrl,
  };
}

export function getWishlistSwatch(color: WishlistColor) {
  return WISHLIST_COLOR_META[color].accent;
}
