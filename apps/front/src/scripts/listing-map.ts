import maplibregl, {
  type GeoJSONSource,
  type MapGeoJSONFeature,
  type MapLayerMouseEvent,
  type Popup,
  type StyleSpecification,
} from "maplibre-gl";
import { layers, namedFlavor } from "@protomaps/basemaps";

import {
  acquirePmtilesProtocol,
  releasePmtilesProtocol,
} from "../lib/map/pmtiles-protocol";
import {
  addWishlistItem,
  createWishlist,
  emitWishlistChanged,
  fetchWishlists as fetchWishlistsCollection,
  GUEST_WISHLIST_STORAGE_KEY,
  guestWishlistToWishlist,
  guestWishlistHasListing,
  getSavedListingIdsFromWishlists,
  readGuestWishlist,
  removeWishlistItem,
  removeGuestWishlistListing,
  upsertGuestWishlistListing,
} from "../features/wishlist";
import type {
  Wishlist,
  WishlistColor,
} from "../features/wishlist";
import {
  applyWishlistStateToFeatures,
  createWishlistPriceMarker,
  getWishlistMarkerColors,
  getWishlistSwatch,
  syncWishlistButtonState,
  toWishlistListingSummary,
  type WishlistMapFeature,
  type WishlistMapFeatureCollection,
  type WishlistMapListingProperties,
} from "../features/wishlist/map-view";

const DEFAULT_CENTER: [number, number] = [19.1451, 51.9194];
const DEFAULT_ZOOM = 6;
const DEFAULT_PMTILES_URL =
  "https://pub-bfaa61c41d364f489c3ef9b268baf004.r2.dev/poland.pmtiles";
const DEFAULT_LISTINGS_API_URL = "/api/listings";
const PROTOMAPS_SOURCE_ID = "protomaps";
const LISTINGS_SOURCE_ID = "listings";
const DRAW_SOURCE_ID = "listing-draw";
const CLUSTERS_LAYER_ID = "listing-clusters";
const CLUSTER_COUNT_LAYER_ID = "listing-cluster-count";
const UNCLUSTERED_LAYER_ID = "listing-points";
const DRAW_LINE_LAYER_ID = "listing-draw-line";
const DRAW_FILL_LAYER_ID = "listing-draw-fill";
const PLACEHOLDER_THUMBNAIL = "/listing-placeholder.svg";
const FOCUSED_LISTING_ZOOM = 13;
const DRAW_SAMPLE_DISTANCE_PX = 10;
const DRAW_MIN_AREA_PX = 600;
const DEFAULT_API_BASE_URL = "http://localhost:3000";

type ListingProperties = WishlistMapListingProperties;
type ListingFeature = WishlistMapFeature;
type ListingFeatureCollection = WishlistMapFeatureCollection;

type SearchFilters = Partial<{
  transaction_type: "sale" | "rent";
  category_id: number;
  min_price: number;
  max_price: number;
  rooms: number;
}>;

type Bbox = [number, number, number, number];
type DrawPoint = [number, number];

type SearchPolygon = {
  type: "Polygon";
  coordinates: [DrawPoint[]];
};

type SearchPayload = SearchFilters & {
  shape:
    | {
        type: "bbox";
        bbox: Bbox;
      }
    | {
        type: "polygon";
        geometry: SearchPolygon;
      };
};

type DrawFeatureCollection = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    geometry:
      | {
          type: "LineString";
          coordinates: DrawPoint[];
        }
      | SearchPolygon;
    properties: {
      kind: "line" | "polygon";
    };
  }>;
};

type DrawMode = "browse" | "draw-armed" | "drawing" | "draw-applied";
type StatusKind = "idle" | "info" | "error";

const EMPTY_FEATURE_COLLECTION: ListingFeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

const EMPTY_DRAW_COLLECTION: DrawFeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

function debounce<T extends (...args: never[]) => void>(
  callback: T,
  delayMs: number,
): T & { cancel: () => void } {
  let timeoutId: number | undefined;

  const debounced = ((...args: never[]) => {
    window.clearTimeout(timeoutId);
    timeoutId = window.setTimeout(() => callback(...args), delayMs);
  }) as T & { cancel: () => void };

  debounced.cancel = () => {
    window.clearTimeout(timeoutId);
  };

  return debounced;
}

function parseCenter(value: string | undefined): [number, number] {
  if (!value) {
    return DEFAULT_CENTER;
  }

  try {
    const parsed = JSON.parse(value);
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      parsed.every((coordinate) => Number.isFinite(coordinate))
    ) {
      return [Number(parsed[0]), Number(parsed[1])];
    }
  } catch (error) {
    console.warn("Invalid map center configuration", error);
  }

  return DEFAULT_CENTER;
}

function parseZoom(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : DEFAULT_ZOOM;
}

function parseBounds(
  value: string | undefined,
): [number, number, number, number] | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value);
    if (
      Array.isArray(parsed) &&
      parsed.length === 4 &&
      parsed.every((coordinate) => Number.isFinite(coordinate))
    ) {
      return [
        Number(parsed[0]),
        Number(parsed[1]),
        Number(parsed[2]),
        Number(parsed[3]),
      ];
    }
  } catch (error) {
    console.warn("Invalid map bounds configuration", error);
  }

  return null;
}

function formatPrice(price: number): string {
  if (!Number.isFinite(price)) {
    return "Cena niedostępna";
  }

  return price + " PLN";
}

function formatRooms(rooms: number): string {
  if (!Number.isFinite(rooms)) {
    return "Liczba pokoi niedostępna";
  }

  if (rooms === 1) {
    return "1 pokój";
  }

  const lastDigit = rooms % 10;
  const lastTwoDigits = rooms % 100;
  const usesFewForm =
    lastDigit >= 2 &&
    lastDigit <= 4 &&
    (lastTwoDigits < 12 || lastTwoDigits > 14);

  return `${rooms} ${usesFewForm ? "pokoje" : "pokoi"}`;
}

function formatTransactionType(transactionType: string): string {
  if (transactionType === "sale") {
    return "Kupno";
  }

  if (transactionType === "rent") {
    return "Wynajem";
  }

  return transactionType || "Oferta";
}

function formatOfferCountLabel(count: number): string {
  if (count === 1) {
    return "oferta";
  }

  const lastDigit = count % 10;
  const lastTwoDigits = count % 100;
  const usesFewForm =
    lastDigit >= 2 &&
    lastDigit <= 4 &&
    (lastTwoDigits < 12 || lastTwoDigits > 14);

  return usesFewForm ? "oferty" : "ofert";
}

function createMapStyle(pmtilesUrl: string): StyleSpecification {
  return {
    version: 8,
    glyphs:
      "https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf",
    sprite: "https://protomaps.github.io/basemaps-assets/sprites/v4/light",
    sources: {
      [PROTOMAPS_SOURCE_ID]: {
        type: "vector",
        attribution:
          '<a href="https://github.com/protomaps/basemaps">Protomaps</a> © <a href="https://osm.org/copyright">OpenStreetMap</a>',
        url: `pmtiles://${pmtilesUrl}`,
      },
    },
    layers: layers(PROTOMAPS_SOURCE_ID, namedFlavor("grayscale"), {
      lang: "pl",
    }),
  };
}

function getListingsSource(map: maplibregl.Map): GeoJSONSource | null {
  const source = map.getSource(LISTINGS_SOURCE_ID);
  if (!source || !("setData" in source)) {
    return null;
  }

  return source as GeoJSONSource;
}

function getDrawSource(map: maplibregl.Map): GeoJSONSource | null {
  const source = map.getSource(DRAW_SOURCE_ID);
  if (!source || !("setData" in source)) {
    return null;
  }

  return source as GeoJSONSource;
}

function getFeatureCoordinates(
  feature: MapGeoJSONFeature | ListingFeature | undefined,
): [number, number] | null {
  if (!feature || feature.geometry.type !== "Point") {
    return null;
  }

  const [lng, lat] = feature.geometry.coordinates;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    return null;
  }

  return [lng, lat];
}

function normalizeFeatureCollection(data: unknown): ListingFeatureCollection {
  if (
    typeof data === "object" &&
    data !== null &&
    "type" in data &&
    "features" in data &&
    (data as { type?: unknown }).type === "FeatureCollection" &&
    Array.isArray((data as { features?: unknown[] }).features)
  ) {
    return data as ListingFeatureCollection;
  }

  return EMPTY_FEATURE_COLLECTION;
}

function normalizeListingProperties(
  properties: Partial<ListingProperties> | undefined,
): ListingProperties | null {
  if (!properties) {
    return null;
  }

  const id = Number(properties.id ?? 0);
  if (!Number.isFinite(id)) {
    return null;
  }

  return {
    id,
    slug: String(properties.slug ?? ""),
    title: String(properties.title ?? "Oferta"),
    price: Number(properties.price ?? 0),
    rooms: Number(properties.rooms ?? 0),
    transactionType: String(properties.transactionType ?? ""),
    thumbnailUrl: String(properties.thumbnailUrl || PLACEHOLDER_THUMBNAIL),
    city: String(properties.city ?? ""),
    street: String(properties.street ?? ""),
    saved: Boolean(properties.saved),
    savedColor:
      typeof properties.savedColor === "string"
        ? properties.savedColor
        : undefined,
  };
}

function getFeatureProperties(
  feature: MapGeoJSONFeature | ListingFeature | undefined,
): ListingProperties | null {
  if (!feature || !feature.properties) {
    return null;
  }

  return normalizeListingProperties(
    feature.properties as Partial<ListingProperties>,
  );
}

function createPopupContent(properties: ListingProperties): HTMLElement {
  const article = document.createElement("article");
  article.className = "listing-popup";

  const image = document.createElement("img");
  image.className = "listing-popup__image";
  image.src = properties.thumbnailUrl || PLACEHOLDER_THUMBNAIL;
  image.alt = properties.title || "Oferta";
  image.loading = "lazy";

  const body = document.createElement("div");
  body.className = "listing-popup__body";

  const eyebrow = document.createElement("div");
  eyebrow.className = "listing-popup__eyebrow";
  eyebrow.textContent = formatTransactionType(properties.transactionType);

  const title = document.createElement("h3");
  title.className = "listing-popup__title";
  title.textContent = properties.title || "Oferta";

  const meta = document.createElement("p");
  meta.className = "listing-popup__meta";
  meta.textContent = `${properties.street || "Adres niedostępny"}, ${
    properties.city || "Polska"
  }`;

  const details = document.createElement("div");
  details.className = "listing-popup__details";

  const actions = document.createElement("div");
  actions.className = "listing-popup__actions";

  const saveButton = document.createElement("button");
  saveButton.type = "button";
  saveButton.className = "listing-popup__save";
  saveButton.dataset.popupWishlistSave = "true";
  saveButton.dataset.listingId = String(properties.id);
  saveButton.dataset.active = properties.saved ? "true" : "false";
  if (properties.savedColor) {
    saveButton.style.backgroundColor = properties.savedColor;
    saveButton.style.borderColor = properties.savedColor;
  }
  saveButton.setAttribute(
    "aria-label",
    properties.saved ? "Usuń ofertę z wishlisty" : "Dodaj ofertę do wishlisty",
  );
  saveButton.textContent = "♥";

  const price = document.createElement("span");
  price.textContent = formatPrice(properties.price);

  const rooms = document.createElement("span");
  rooms.textContent = formatRooms(properties.rooms);

  details.appendChild(price);
  details.appendChild(rooms);
  actions.appendChild(saveButton);
  body.appendChild(eyebrow);
  body.appendChild(title);
  body.appendChild(meta);
  body.appendChild(details);
  body.appendChild(actions);
  article.appendChild(image);
  article.appendChild(body);

  return article;
}

function createListingCard(feature: ListingFeature): HTMLButtonElement {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "listing-map__card";
  card.dataset.listingCard = "true";
  card.dataset.listingId = String(feature.properties.id);
  card.setAttribute(
    "aria-label",
    `${feature.properties.title}, ${formatPrice(feature.properties.price)}`,
  );

  const saveButton = document.createElement("button");
  saveButton.type = "button";
  saveButton.className = "listing-map__card-save";
  saveButton.dataset.listingSave = "true";
  saveButton.dataset.listingId = String(feature.properties.id);
  saveButton.dataset.active = feature.properties.saved ? "true" : "false";
  if (feature.properties.savedColor) {
    saveButton.style.backgroundColor = feature.properties.savedColor;
    saveButton.style.borderColor = feature.properties.savedColor;
  }
  saveButton.setAttribute(
    "aria-label",
    feature.properties.saved
      ? "Usuń ofertę z wishlisty"
      : "Dodaj ofertę do wishlisty",
  );
  saveButton.textContent = "♥";

  const eyebrow = document.createElement("div");
  eyebrow.className = "listing-map__card-eyebrow";
  eyebrow.textContent = formatTransactionType(
    feature.properties.transactionType,
  );

  const title = document.createElement("h3");
  title.className = "listing-map__card-title";
  title.textContent = feature.properties.title || "Oferta";

  const meta = document.createElement("div");
  meta.className = "listing-map__card-meta";

  const price = document.createElement("span");
  price.textContent = formatPrice(feature.properties.price);

  const rooms = document.createElement("span");
  rooms.textContent = formatRooms(feature.properties.rooms);

  meta.appendChild(price);
  meta.appendChild(rooms);

  const location = document.createElement("div");
  location.className = "listing-map__card-location";
  location.textContent = `${feature.properties.street || "Adres niedostępny"}, ${
    feature.properties.city || "Polska"
  }`;

  card.appendChild(saveButton);
  card.appendChild(eyebrow);
  card.appendChild(title);
  card.appendChild(meta);
  card.appendChild(location);
  return card;
}

function parsePositiveInteger(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value.trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parseNonNegativeNumber(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const normalizedValue = value.trim().replace(/\s+/g, "");
  if (normalizedValue.length === 0) {
    return undefined;
  }

  const parsed = Number(normalizedValue);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function parseSearchFiltersFromUrl(): SearchFilters {
  const params = new URLSearchParams(window.location.search);
  const transactionType = params.get("transaction_type");
  const filters: SearchFilters = {};

  if (transactionType === "sale" || transactionType === "rent") {
    filters.transaction_type = transactionType;
  }

  const categoryId = parsePositiveInteger(params.get("category_id"));
  if (typeof categoryId === "number") {
    filters.category_id = categoryId;
  }

  const minPrice = parseNonNegativeNumber(params.get("min_price"));
  if (typeof minPrice === "number") {
    filters.min_price = minPrice;
  }

  const maxPrice = parseNonNegativeNumber(params.get("max_price"));
  if (typeof maxPrice === "number") {
    filters.max_price = maxPrice;
  }

  const rooms = parsePositiveInteger(params.get("rooms"));
  if (typeof rooms === "number") {
    filters.rooms = rooms;
  }

  return filters;
}

function buildSearchPayload(
  map: maplibregl.Map,
  polygon: SearchPolygon | null,
): SearchPayload {
  const filters = parseSearchFiltersFromUrl();

  if (polygon) {
    return {
      ...filters,
      shape: {
        type: "polygon",
        geometry: polygon,
      },
    };
  }

  const bounds = map.getBounds();
  return {
    ...filters,
    shape: {
      type: "bbox",
      bbox: [
        Number(bounds.getWest().toFixed(6)),
        Number(bounds.getSouth().toFixed(6)),
        Number(bounds.getEast().toFixed(6)),
        Number(bounds.getNorth().toFixed(6)),
      ],
    },
  };
}

function areDrawPointsEqual([lngA, latA]: DrawPoint, [lngB, latB]: DrawPoint) {
  return Math.abs(lngA - lngB) < 1e-9 && Math.abs(latA - latB) < 1e-9;
}

function normalizeDrawRing(points: DrawPoint[]): DrawPoint[] {
  const normalized: DrawPoint[] = [];

  for (const point of points) {
    const previous = normalized[normalized.length - 1];
    if (!previous || !areDrawPointsEqual(previous, point)) {
      normalized.push(point);
    }
  }

  if (normalized.length < 3) {
    return [];
  }

  const first = normalized[0];
  const last = normalized[normalized.length - 1];
  if (!last || !areDrawPointsEqual(first, last)) {
    normalized.push(first);
  }

  return normalized.length >= 4 ? normalized : [];
}

function buildDrawFeatureCollection(
  sketchCoordinates: DrawPoint[],
  polygon: SearchPolygon | null,
): DrawFeatureCollection {
  const features: DrawFeatureCollection["features"] = [];

  if (sketchCoordinates.length >= 2) {
    features.push({
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: sketchCoordinates,
      },
      properties: {
        kind: "line",
      },
    });
  }

  if (polygon) {
    features.push({
      type: "Feature",
      geometry: polygon,
      properties: {
        kind: "polygon",
      },
    });
  }

  return {
    type: "FeatureCollection",
    features,
  };
}

function computePolygonArea(points: Array<[number, number]>): number {
  if (points.length < 3) {
    return 0;
  }

  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const [currentX, currentY] = points[index];
    const [nextX, nextY] = points[(index + 1) % points.length];
    area += currentX * nextY - nextX * currentY;
  }

  return Math.abs(area / 2);
}

function getRelativePoint(
  canvas: HTMLElement,
  event: PointerEvent,
): [number, number] {
  const rect = canvas.getBoundingClientRect();
  const x = Math.min(Math.max(event.clientX - rect.left, 0), rect.width);
  const y = Math.min(Math.max(event.clientY - rect.top, 0), rect.height);
  return [x, y];
}

function getDistanceBetweenPoints(
  [firstX, firstY]: [number, number],
  [secondX, secondY]: [number, number],
) {
  return Math.hypot(secondX - firstX, secondY - firstY);
}

export function mountListingMap(root: HTMLElement): () => void {
  const canvas = root.querySelector<HTMLElement>("[data-listing-map-canvas]");
  const status = root.querySelector<HTMLElement>("[data-listing-map-status]");
  const listItems = root.querySelector<HTMLElement>(
    "[data-listing-list-items]",
  );
  const emptyState = root.querySelector<HTMLElement>(
    "[data-listing-list-empty]",
  );
  const listSummary = root.querySelector<HTMLElement>(
    "[data-listing-list-summary]",
  );
  const wishlistDialog = root.querySelector<HTMLDialogElement>(
    "[data-wishlist-dialog]",
  );
  const wishlistOptions = root.querySelector<HTMLElement>(
    "[data-wishlist-options]",
  );
  const wishlistSummary = root.querySelector<HTMLElement>(
    "[data-wishlist-dialog-summary]",
  );
  const wishlistNote = root.querySelector<HTMLElement>(
    "[data-wishlist-dialog-note]",
  );
  const wishlistNewName = root.querySelector<HTMLInputElement>(
    "[data-wishlist-new-name]",
  );
  const wishlistNewColor = root.querySelector(
    "[data-wishlist-new-color]",
  ) as HTMLSelectElement | null;
  const wishlistCreateButton = root.querySelector<HTMLButtonElement>(
    "[data-wishlist-create-button]",
  );
  const drawToggle =
    root.querySelector<HTMLButtonElement>("[data-draw-toggle]");
  const clearDrawing = root.querySelector<HTMLButtonElement>(
    "[data-clear-drawing]",
  );
  const drawingOverlay = root.querySelector<HTMLElement>(
    "[data-listing-map-drawing-overlay]",
  );
  const drawControls =
    drawToggle instanceof HTMLButtonElement &&
    clearDrawing instanceof HTMLButtonElement &&
    drawingOverlay instanceof HTMLElement
      ? {
          drawToggle,
          clearDrawing,
          drawingOverlay,
        }
      : null;

  if (!canvas || !listItems || !emptyState || !listSummary) {
    throw new Error("Listing map canvas is missing");
  }

  const initialCenter = parseCenter(root.dataset.initialCenter);
  const initialBounds = parseBounds(root.dataset.initialBounds);
  const initialZoom = parseZoom(root.dataset.initialZoom);
  const apiBaseUrl = root.dataset.apiBaseUrl || DEFAULT_API_BASE_URL;
  const isAuthenticated = root.dataset.authenticated === "true";
  const pmtilesUrl = root.dataset.pmtilesUrl || DEFAULT_PMTILES_URL;
  const listingsApiUrl =
    root.dataset.listingsApiUrl || DEFAULT_LISTINGS_API_URL;
  const drawToSearchEnabled =
    root.dataset.enableDrawToSearch === "true" && drawControls !== null;

  acquirePmtilesProtocol();

  let activePopup: Popup | null = null;
  let abortController: AbortController | null = null;
  let isDestroyed = false;
  let activeListingId: number | null = null;
  let statusKind: StatusKind = "idle";
  let drawMode: DrawMode = "browse";
  let drawPointerId: number | null = null;
  let drawScreenPoints: Array<[number, number]> = [];
  let drawCoordinates: DrawPoint[] = [];
  let activeSearchPolygon: SearchPolygon | null = null;
  let activeWishlistListing: ListingProperties | null = null;
  let savedListingIds = new Set<number>();
  let savedListingColors = new Map<number, string>();
  let wishlists: Wishlist[] = [];
  let wishlistActionInFlight = false;
  const featuresById = new Map<number, ListingFeature>();
  const visiblePriceMarkers = new Map<number, maplibregl.Marker>();

  const map = new maplibregl.Map({
    container: canvas,
    style: createMapStyle(pmtilesUrl),
    center: initialCenter,
    zoom: initialZoom,
  });

  map.addControl(new maplibregl.NavigationControl(), "bottom-right");

  const setStatus = (
    message: string | null,
    kind: Exclude<StatusKind, "idle"> = "error",
  ) => {
    if (!status) {
      return;
    }

    if (!message) {
      status.textContent = "";
      status.hidden = true;
      statusKind = "idle";
      root.dataset.status = "idle";
      return;
    }

    status.hidden = false;
    status.textContent = message;
    statusKind = kind;
    root.dataset.status = kind;
  };

  const clearInfoStatus = () => {
    if (statusKind === "info") {
      setStatus(null);
    }
  };

  const setListSummary = (message: string) => {
    listSummary.textContent = message;
  };

  const setActiveListing = (listingId: number | null) => {
    activeListingId = listingId;

    listItems
      .querySelectorAll<HTMLElement>("[data-listing-card]")
      .forEach((element) => {
        const isActive =
          listingId !== null && element.dataset.listingId === String(listingId);
        element.classList.toggle("is-active", isActive);
      });
  };

  const scrollCardIntoView = (listingId: number) => {
    const card = listItems.querySelector<HTMLElement>(
      `[data-listing-id="${listingId}"]`,
    );

    if (!card) {
      return;
    }

    card.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    });
  };

  const getSearchContextLabel = () =>
    activeSearchPolygon ? "w narysowanym obszarze" : "w aktualnym widoku";

  const renderListingList = (features: ListingFeature[]) => {
    listItems.replaceChildren();
    emptyState.hidden = features.length > 0;
    emptyState.textContent = activeSearchPolygon
      ? "Brak ofert w narysowanym obszarze"
      : "Brak ofert w tym obszarze";

    if (features.length === 0) {
      setListSummary(
        activeSearchPolygon
          ? "Nie znaleźliśmy ofert w narysowanym obszarze."
          : "Przesuń mapę, aby wyszukać oferty w innej okolicy.",
      );
      setActiveListing(null);
      return;
    }

    setListSummary(
      `${features.length} ${formatOfferCountLabel(features.length)} ${getSearchContextLabel()}`,
    );

    const fragment = document.createDocumentFragment();
    for (const feature of features) {
      fragment.appendChild(createListingCard(feature));
    }

    listItems.appendChild(fragment);
    setActiveListing(activeListingId);
  };

  const syncCardSavedStates = () => {
    listItems
      .querySelectorAll<HTMLElement>("[data-listing-save]")
      .forEach((element) => {
        const listingId = Number(element.dataset.listingId);
        const isSaved =
          Number.isFinite(listingId) && savedListingIds.has(listingId);
        const savedColor = Number.isFinite(listingId)
          ? savedListingColors.get(listingId)
          : undefined;
        syncWishlistButtonState(element, isSaved, savedColor);
      });
  };

  const applySavedFlags = (
    features: ListingFeatureCollection,
  ): ListingFeatureCollection =>
    applyWishlistStateToFeatures(features, savedListingIds, savedListingColors);

  const updateMapSavedState = () => {
    const source = getListingsSource(map);
    if (!source) {
      syncCardSavedStates();
      return;
    }

    const currentData = (source as { _data?: unknown })._data as
      | ListingFeatureCollection
      | undefined;
    if (currentData?.type === "FeatureCollection") {
      source.setData(applySavedFlags(currentData));
    }
    syncCardSavedStates();
    window.requestAnimationFrame(() => {
      renderVisiblePriceMarkers();
    });
  };

  const clearPriceMarkers = () => {
    visiblePriceMarkers.forEach((marker) => marker.remove());
    visiblePriceMarkers.clear();
  };

  const renderVisiblePriceMarkers = () => {
    if (!map.isStyleLoaded()) {
      return;
    }

    const rendered = map.queryRenderedFeatures(undefined, {
      layers: [UNCLUSTERED_LAYER_ID],
    });
    const nextIds = new Set<number>();

    for (const renderedFeature of rendered) {
      const properties = getFeatureProperties(renderedFeature);
      const coordinates = getFeatureCoordinates(renderedFeature);

      if (!properties || !coordinates || nextIds.has(properties.id)) {
        continue;
      }

      nextIds.add(properties.id);
      const existingMarker = visiblePriceMarkers.get(properties.id);
      if (existingMarker) {
        const element = existingMarker.getElement() as HTMLButtonElement;
        element.dataset.saved = properties.saved ? "true" : "false";
        if (properties.saved && properties.savedColor) {
          element.style.backgroundColor = properties.savedColor;
          element.style.borderColor = properties.savedColor;
          element.style.color = "#ffffff";
        } else {
          element.style.backgroundColor = "";
          element.style.borderColor = "";
          element.style.color = "";
        }
        existingMarker.setLngLat(coordinates);
        continue;
      }

      const marker = new maplibregl.Marker({
        element: createWishlistPriceMarker(
          properties,
          `${properties.price.toLocaleString("pl-PL")}`,
          () => {
            const feature = featuresById.get(properties.id);
            openListingPopup(feature);
          },
        ),
        anchor: "center",
      })
        .setLngLat(coordinates)
        .addTo(map);

      visiblePriceMarkers.set(properties.id, marker);
    }

    for (const [listingId, marker] of visiblePriceMarkers.entries()) {
      if (!nextIds.has(listingId)) {
        marker.remove();
        visiblePriceMarkers.delete(listingId);
      }
    }
  };

  const syncWishlistDialogNote = (message: string | null) => {
    if (!wishlistNote) {
      return;
    }

    wishlistNote.hidden = !message;
    wishlistNote.textContent = message ?? "";
  };

  const setWishlistDialogBusy = (busy: boolean, message?: string) => {
    wishlistActionInFlight = busy;
    wishlistDialog?.toggleAttribute("data-busy", busy);
    wishlistCreateButton && (wishlistCreateButton.disabled = busy);
    wishlistOptions
      ?.querySelectorAll<HTMLButtonElement>("[data-wishlist-id]")
      .forEach((button) => {
        button.disabled = busy;
      });

    if (busy) {
      syncWishlistDialogNote(message ?? "Zapisywanie zmian...");
    }
  };

  const emitCurrentWishlistState = () => {
    if (isAuthenticated) {
      emitWishlistChanged({
        mode: "user",
        savedListingIds: Array.from(savedListingIds),
        wishlists,
        guestWishlist: null,
      });
      return;
    }

    const guestWishlist = readGuestWishlist(GUEST_WISHLIST_STORAGE_KEY);
    emitWishlistChanged({
      mode: "guest",
      savedListingIds: guestWishlist.listingIds,
      wishlists: [guestWishlistToWishlist(readGuestWishlist(GUEST_WISHLIST_STORAGE_KEY))],
      guestWishlist,
    });
  };

  const reloadWishlists = async () => {
    if (isAuthenticated) {
      wishlists = await fetchWishlistsCollection(apiBaseUrl);
      savedListingIds = new Set(getSavedListingIdsFromWishlists(wishlists));
      savedListingColors = getWishlistMarkerColors(wishlists);
    } else {
      const guestWishlist = readGuestWishlist(GUEST_WISHLIST_STORAGE_KEY);
      savedListingIds = new Set(guestWishlist.listingIds);
      savedListingColors = new Map<number, string>();
      for (const listingId of guestWishlist.listingIds) {
        savedListingColors.set(
          listingId,
          getWishlistSwatch(guestWishlist.color),
        );
      }
    }

    updateMapSavedState();
  };

  const closeWishlistDialog = () => {
    syncWishlistDialogNote(null);
    activeWishlistListing = null;
    if (wishlistDialog?.open) {
      wishlistDialog.close();
    }
  };

  const renderWishlistOptions = () => {
    if (!wishlistOptions || !wishlistSummary) {
      return;
    }

    wishlistOptions.replaceChildren();

    if (!activeWishlistListing) {
      wishlistSummary.textContent =
        "Wybierz ofertę, aby zarządzać wishlistami.";
      return;
    }

    wishlistSummary.textContent = activeWishlistListing.title;
    const listingId = activeWishlistListing.id;

    for (const wishlist of wishlists) {
      const hasListing = wishlist.items.some(
        (item) => item.listing_id === listingId,
      );

      const option = document.createElement("div");
      option.className = "listing-map__wishlist-option";

      const main = document.createElement("div");
      main.className = "listing-map__wishlist-option-main";

      const swatch = document.createElement("span");
      swatch.className = "listing-map__wishlist-swatch";
      swatch.style.backgroundColor = getWishlistSwatch(wishlist.color);

      const labels = document.createElement("div");
      const label = document.createElement("p");
      label.className = "listing-map__wishlist-option-label";
      label.textContent = wishlist.name;
      const meta = document.createElement("p");
      meta.className = "listing-map__wishlist-option-meta";
      meta.textContent = `${wishlist.items.length} ofert`;
      labels.appendChild(label);
      labels.appendChild(meta);

      main.appendChild(swatch);
      main.appendChild(labels);

      const toggleButton = document.createElement("button");
      toggleButton.type = "button";
      toggleButton.className = "listing-map__wishlist-toggle";
      toggleButton.dataset.active = hasListing ? "true" : "false";
      toggleButton.dataset.wishlistId = String(wishlist.id);
      toggleButton.textContent = hasListing ? "Usuń" : "Dodaj";

      option.appendChild(main);
      option.appendChild(toggleButton);
      wishlistOptions.appendChild(option);
    }
  };

  const openWishlistDialog = async (properties: ListingProperties) => {
    activeWishlistListing = properties;
    syncWishlistDialogNote(null);

    if (!isAuthenticated) {
      if (guestWishlistHasListing(GUEST_WISHLIST_STORAGE_KEY, properties.id)) {
        removeGuestWishlistListing(GUEST_WISHLIST_STORAGE_KEY, properties.id);
      } else {
        upsertGuestWishlistListing(
          GUEST_WISHLIST_STORAGE_KEY,
          toWishlistListingSummary(properties),
        );
      }

      await reloadWishlists();
      renderWishlistOptions();
      emitCurrentWishlistState();
      if (activePopup) {
        activePopup.remove();
      }
      return;
    }

    await reloadWishlists();
    renderWishlistOptions();
    wishlistDialog?.showModal();
  };

  const openListingPopup = (
    feature: MapGeoJSONFeature | ListingFeature | undefined,
    referenceLng?: number,
  ) => {
    const coordinates = getFeatureCoordinates(feature);
    const properties = getFeatureProperties(feature);

    if (!coordinates || !properties) {
      return;
    }

    const popupCoordinates: [number, number] = [...coordinates];

    if (typeof referenceLng === "number" && Number.isFinite(referenceLng)) {
      while (Math.abs(referenceLng - popupCoordinates[0]) > 180) {
        popupCoordinates[0] += referenceLng > popupCoordinates[0] ? 360 : -360;
      }
    }

    activePopup?.remove();

    const popup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: true,
      maxWidth: "320px",
      offset: 18,
    })
      .setLngLat(popupCoordinates)
      .setDOMContent(createPopupContent(properties))
      .addTo(map);

    const popupElement = popup.getElement();
    const popupSaveButton = popupElement.querySelector<HTMLButtonElement>(
      "[data-popup-wishlist-save]",
    );
    popupSaveButton?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void openWishlistDialog(properties);
    });

    popup.on("close", () => {
      if (activePopup === popup) {
        activePopup = null;
      }
      setActiveListing(null);
    });

    activePopup = popup;
    setActiveListing(properties.id);
    scrollCardIntoView(properties.id);
  };

  const setPointerCursor = () => {
    map.getCanvas().style.cursor = "pointer";
  };

  const clearPointerCursor = () => {
    map.getCanvas().style.cursor = "";
  };

  const setDrawSourceData = (
    sketchCoordinates: DrawPoint[] = [],
    polygon: SearchPolygon | null = activeSearchPolygon,
  ) => {
    if (!drawToSearchEnabled || !drawControls) {
      return;
    }

    const source = getDrawSource(map);
    source?.setData(buildDrawFeatureCollection(sketchCoordinates, polygon));
  };

  const setMapInteractionsEnabled = (enabled: boolean) => {
    if (enabled) {
      map.dragPan.enable();
      map.scrollZoom.enable();
      map.boxZoom.enable();
      map.doubleClickZoom.enable();
      map.touchZoomRotate.enable();
      map.keyboard.enable();
      return;
    }

    map.dragPan.disable();
    map.scrollZoom.disable();
    map.boxZoom.disable();
    map.doubleClickZoom.disable();
    map.touchZoomRotate.disable();
    map.keyboard.disable();
  };

  const syncDrawUi = () => {
    root.dataset.drawMode = drawMode;

    if (!drawToSearchEnabled || !drawControls) {
      return;
    }

    drawControls.drawToggle.dataset.active =
      drawMode === "draw-armed" || drawMode === "drawing" ? "true" : "false";
    drawControls.drawToggle.setAttribute(
      "aria-pressed",
      drawMode === "draw-armed" || drawMode === "drawing" ? "true" : "false",
    );
    drawControls.drawToggle.textContent =
      drawMode === "draw-armed" || drawMode === "drawing"
        ? "Anuluj rysowanie"
        : "Rysuj obszar";

    drawControls.clearDrawing.disabled = drawMode !== "draw-applied";
    drawControls.drawingOverlay.hidden =
      drawMode !== "draw-armed" && drawMode !== "drawing";

    setMapInteractionsEnabled(
      drawMode !== "draw-armed" && drawMode !== "drawing",
    );
  };

  const setDrawMode = (nextMode: DrawMode) => {
    drawMode = nextMode;
    syncDrawUi();
  };

  const fetchListings = async () => {
    if (isDestroyed) {
      return;
    }

    const source = getListingsSource(map);
    if (!source) {
      return;
    }

    abortController?.abort();
    abortController = new AbortController();

    try {
      const response = await fetch(listingsApiUrl, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify(buildSearchPayload(map, activeSearchPolygon)),
        signal: abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`Listing fetch failed with ${response.status}`);
      }

      const payload = applySavedFlags(
        normalizeFeatureCollection(await response.json()),
      );
      featuresById.clear();
      for (const feature of payload.features) {
        featuresById.set(feature.properties.id, feature);
      }

      source.setData(payload);
      renderListingList(payload.features);

      if (activeListingId !== null && !featuresById.has(activeListingId)) {
        activePopup?.remove();
        activePopup = null;
        setActiveListing(null);
      }

      if (statusKind !== "error") {
        clearInfoStatus();
      } else {
        setStatus(null);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }

      console.error(
        "Failed to refresh listings for the current viewport",
        error,
      );
      setStatus("Nie udało się wczytać ofert dla tego obszaru.");
    }
  };

  const refreshListings = debounce(fetchListings, 300);

  const clearActiveDrawing = async () => {
    activeSearchPolygon = null;
    drawCoordinates = [];
    drawScreenPoints = [];
    drawPointerId = null;
    setDrawSourceData([], null);
    setDrawMode("browse");
    clearInfoStatus();
    await fetchListings();
  };

  const cancelDrawing = () => {
    drawCoordinates = [];
    drawScreenPoints = [];
    drawPointerId = null;
    setDrawSourceData([], activeSearchPolygon);
    setDrawMode(activeSearchPolygon ? "draw-applied" : "browse");
    clearInfoStatus();
  };

  const finalizeDrawing = async () => {
    drawPointerId = null;

    if (
      drawCoordinates.length < 3 ||
      computePolygonArea(drawScreenPoints) < DRAW_MIN_AREA_PX
    ) {
      drawCoordinates = [];
      drawScreenPoints = [];
      setDrawSourceData([], activeSearchPolygon);
      setDrawMode(activeSearchPolygon ? "draw-applied" : "browse");
      setStatus(
        "Narysowany obszar jest zbyt mały. Spróbuj narysować większy kształt.",
        "info",
      );
      return;
    }

    const ring = normalizeDrawRing(drawCoordinates);
    if (ring.length === 0) {
      drawCoordinates = [];
      drawScreenPoints = [];
      setDrawSourceData([], activeSearchPolygon);
      setDrawMode(activeSearchPolygon ? "draw-applied" : "browse");
      setStatus(
        "Nie udało się domknąć obszaru. Spróbuj narysować kształt ponownie.",
        "info",
      );
      return;
    }

    activeSearchPolygon = {
      type: "Polygon",
      coordinates: [ring],
    };
    drawCoordinates = [];
    drawScreenPoints = [];
    setDrawSourceData([], activeSearchPolygon);
    setDrawMode("draw-applied");
    clearInfoStatus();
    await fetchListings();
  };

  const startDrawing = (event: PointerEvent) => {
    if (!drawToSearchEnabled || !drawControls || drawMode !== "draw-armed") {
      return;
    }

    event.preventDefault();

    const screenPoint = getRelativePoint(canvas, event);
    const { lng, lat } = map.unproject(screenPoint);

    drawPointerId = event.pointerId;
    drawScreenPoints = [screenPoint];
    drawCoordinates = [[lng, lat]];
    activeSearchPolygon = null;
    setDrawMode("drawing");
    drawControls.drawingOverlay.setPointerCapture(event.pointerId);
    setDrawSourceData(drawCoordinates, null);
  };

  const extendDrawing = (event: PointerEvent) => {
    if (
      !drawToSearchEnabled ||
      !drawControls ||
      drawMode !== "drawing" ||
      drawPointerId !== event.pointerId
    ) {
      return;
    }

    event.preventDefault();

    const screenPoint = getRelativePoint(canvas, event);
    const previousPoint = drawScreenPoints[drawScreenPoints.length - 1];
    if (
      previousPoint &&
      getDistanceBetweenPoints(previousPoint, screenPoint) <
        DRAW_SAMPLE_DISTANCE_PX
    ) {
      return;
    }

    const { lng, lat } = map.unproject(screenPoint);
    drawScreenPoints.push(screenPoint);
    drawCoordinates.push([lng, lat]);
    setDrawSourceData(drawCoordinates, null);
  };

  const finishDrawing = async (event: PointerEvent) => {
    if (
      !drawToSearchEnabled ||
      !drawControls ||
      drawMode !== "drawing" ||
      drawPointerId !== event.pointerId
    ) {
      return;
    }

    event.preventDefault();
    extendDrawing(event);
    if (drawControls.drawingOverlay.hasPointerCapture(event.pointerId)) {
      drawControls.drawingOverlay.releasePointerCapture(event.pointerId);
    }
    await finalizeDrawing();
  };

  const handleClusterClick = async (event: MapLayerMouseEvent) => {
    const feature = event.features?.[0];
    if (!feature) {
      return;
    }

    const source = getListingsSource(map);
    const clusterId = Number(feature.properties?.cluster_id);
    const pointCount = Number(feature.properties?.point_count ?? 0);

    if (!source || !Number.isFinite(clusterId)) {
      return;
    }

    try {
      const leaves = await source.getClusterLeaves(clusterId, pointCount, 0);
      const bounds = new maplibregl.LngLatBounds();
      let hasCoordinates = false;

      for (const leaf of leaves) {
        const coordinates = getFeatureCoordinates(leaf as MapGeoJSONFeature);
        if (!coordinates) {
          continue;
        }

        bounds.extend(coordinates);
        hasCoordinates = true;
      }

      if (hasCoordinates) {
        map.fitBounds(bounds, {
          padding: 80,
          maxZoom: 15,
          duration: 700,
        });
        return;
      }
    } catch (error) {
      console.warn("Falling back to cluster expansion zoom", error);
    }

    const center = getFeatureCoordinates(feature);
    if (!center) {
      return;
    }

    const zoom = await source.getClusterExpansionZoom(clusterId);
    map.easeTo({
      center,
      zoom,
      duration: 700,
    });
  };

  const handlePointClick = (event: MapLayerMouseEvent) => {
    const feature = event.features?.[0];
    if (!feature) {
      return;
    }
    openListingPopup(feature, event.lngLat.lng);
  };

  const handleMapError = (event: { error?: Error }) => {
    if (event.error) {
      console.error("MapLibre rendering error", event.error);
      setStatus("Nie udało się wyświetlić mapy.");
    }
  };

  const handleMoveEnd = () => {
    if (drawMode === "draw-applied") {
      return;
    }

    renderVisiblePriceMarkers();
    refreshListings();
  };

  const handleDrawToggleClick = async () => {
    if (!drawToSearchEnabled || !drawControls) {
      return;
    }

    if (drawMode === "draw-armed" || drawMode === "drawing") {
      cancelDrawing();
      return;
    }

    if (drawMode === "draw-applied") {
      await clearActiveDrawing();
    }

    setDrawMode("draw-armed");
    setStatus(
      "Przytrzymaj i narysuj obszar na mapie, aby zawęzić wyniki.",
      "info",
    );
  };

  const handleClearDrawingClick = async () => {
    if (drawMode !== "draw-applied") {
      return;
    }

    await clearActiveDrawing();
  };

  const handleWindowKeydown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") {
      return;
    }

    if (drawMode === "draw-armed" || drawMode === "drawing") {
      cancelDrawing();
    }
  };

  const handleLoad = async () => {
    if (isDestroyed) {
      return;
    }

    map.addSource(LISTINGS_SOURCE_ID, {
      type: "geojson",
      data: EMPTY_FEATURE_COLLECTION,
      cluster: true,
      clusterMaxZoom: 14,
      clusterRadius: 50,
    });

    map.addSource(DRAW_SOURCE_ID, {
      type: "geojson",
      data: EMPTY_DRAW_COLLECTION,
    });

    map.addLayer({
      id: DRAW_FILL_LAYER_ID,
      type: "fill",
      source: DRAW_SOURCE_ID,
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: {
        "fill-color": "#8a7760",
        "fill-opacity": 0.16,
        "fill-outline-color": "#493c2f",
      },
    });

    map.addLayer({
      id: DRAW_LINE_LAYER_ID,
      type: "line",
      source: DRAW_SOURCE_ID,
      filter: ["==", ["geometry-type"], "LineString"],
      paint: {
        "line-color": "#493c2f",
        "line-width": 3,
        "line-opacity": 0.94,
      },
    });

    map.addLayer({
      id: CLUSTERS_LAYER_ID,
      type: "circle",
      source: LISTINGS_SOURCE_ID,
      filter: ["has", "point_count"],
      paint: {
        "circle-color": [
          "step",
          ["get", "point_count"],
          "#8f7b61",
          25,
          "#6f5d49",
          100,
          "#493c2f",
        ],
        "circle-radius": ["step", ["get", "point_count"], 18, 25, 26, 100, 34],
        "circle-stroke-width": 2,
        "circle-stroke-color": "#fffaf4",
        "circle-opacity": 0.92,
      },
    });

    map.addLayer({
      id: CLUSTER_COUNT_LAYER_ID,
      type: "symbol",
      source: LISTINGS_SOURCE_ID,
      filter: ["has", "point_count"],
      layout: {
        "text-field": "{point_count_abbreviated}",
        "text-font": ["Noto Sans Regular"],
        "text-size": 12,
      },
      paint: {
        "text-color": "#ffffff",
      },
    });

    map.addLayer({
      id: UNCLUSTERED_LAYER_ID,
      type: "circle",
      source: LISTINGS_SOURCE_ID,
      filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-color": "#201913",
        "circle-radius": 1,
        "circle-opacity": 0,
        "circle-stroke-width": 0,
      },
    });

    map.on("click", CLUSTERS_LAYER_ID, handleClusterClick);
    map.on("click", UNCLUSTERED_LAYER_ID, handlePointClick);
    map.on("mouseenter", CLUSTERS_LAYER_ID, setPointerCursor);
    map.on("mouseleave", CLUSTERS_LAYER_ID, clearPointerCursor);
    map.on("mouseenter", UNCLUSTERED_LAYER_ID, setPointerCursor);
    map.on("mouseleave", UNCLUSTERED_LAYER_ID, clearPointerCursor);

    if (initialBounds) {
      map.fitBounds(
        [
          [initialBounds[0], initialBounds[1]],
          [initialBounds[2], initialBounds[3]],
        ],
        {
          duration: 0,
          maxZoom: 14,
          padding: 80,
        },
      );
    }

    await reloadWishlists();
    await fetchListings();
    renderVisiblePriceMarkers();
    map.on("moveend", handleMoveEnd);
  };

  const handleListClick = (event: Event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const saveButton = target.closest<HTMLElement>("[data-listing-save]");
    if (saveButton) {
      event.preventDefault();
      event.stopPropagation();

      const listingId = Number(saveButton.dataset.listingId);
      if (!Number.isFinite(listingId)) {
        return;
      }

      const feature = featuresById.get(listingId);
      const properties = getFeatureProperties(feature);
      if (!properties) {
        return;
      }

      void openWishlistDialog(properties);
      return;
    }

    const card = target.closest<HTMLElement>("[data-listing-card]");
    if (!card) {
      return;
    }

    const listingId = Number(card.dataset.listingId);
    if (!Number.isFinite(listingId)) {
      return;
    }

    const feature = featuresById.get(listingId);
    const coordinates = getFeatureCoordinates(feature);

    if (!feature || !coordinates) {
      return;
    }

    map.flyTo({
      center: coordinates,
      zoom: Math.max(map.getZoom(), FOCUSED_LISTING_ZOOM),
      duration: 900,
      essential: true,
    });

    openListingPopup(feature);
  };

  const handleWishlistOptionsClick = async (event: Event) => {
    const target = event.target;
    if (
      !(target instanceof HTMLElement) ||
      !activeWishlistListing ||
      wishlistActionInFlight
    ) {
      return;
    }

    const button = target.closest<HTMLButtonElement>("[data-wishlist-id]");
    if (!button) {
      return;
    }

    const wishlistId = Number(button.dataset.wishlistId);
    if (!Number.isFinite(wishlistId)) {
      return;
    }

    const wishlist = wishlists.find((item) => item.id === wishlistId);
    if (!wishlist) {
      return;
    }

    const listingId = activeWishlistListing.id;
    const existingItem = wishlist.items.find(
      (item) => item.listing_id === listingId,
    );

    syncWishlistDialogNote(null);

    try {
      setWishlistDialogBusy(true, "Zapisywanie wyboru wishlisty...");
      if (existingItem) {
        await removeWishlistItem(apiBaseUrl, wishlistId, existingItem.id);
      } else {
        await addWishlistItem(apiBaseUrl, wishlistId, listingId);
      }

      await reloadWishlists();
      renderWishlistOptions();
      emitCurrentWishlistState();
    } catch (error) {
      syncWishlistDialogNote(
        error instanceof Error
          ? error.message
          : "Nie udało się zapisać wishlisty.",
      );
    } finally {
      setWishlistDialogBusy(false);
    }
  };

  const handleWishlistCreateClick = async () => {
    if (!wishlistNewName || !wishlistNewColor || wishlistActionInFlight) {
      return;
    }

    const name = wishlistNewName.value.trim();
    if (!name) {
      syncWishlistDialogNote("Podaj nazwę nowej wishlisty.");
      return;
    }

    try {
      setWishlistDialogBusy(true, "Tworzenie wishlisty...");
      const createdWishlist = await createWishlist(apiBaseUrl, {
        name,
        color: wishlistNewColor.value as WishlistColor,
      });
      if (activeWishlistListing) {
        const listingId = activeWishlistListing.id;
        await addWishlistItem(apiBaseUrl, createdWishlist.id, listingId);
      }
      wishlistNewName.value = "";
      wishlistNewColor.value = "sand";
      await reloadWishlists();
      renderWishlistOptions();
      emitCurrentWishlistState();
      syncWishlistDialogNote("Nowa wishlista została utworzona.");
    } catch (error) {
      syncWishlistDialogNote(
        error instanceof Error
          ? error.message
          : "Nie udało się utworzyć wishlisty.",
      );
    } finally {
      setWishlistDialogBusy(false);
    }
  };

  const wishlistOptionsListener = (event: Event) => {
    void handleWishlistOptionsClick(event);
  };

  const wishlistCreateListener = () => {
    void handleWishlistCreateClick();
  };

  listItems.addEventListener("click", handleListClick);
  wishlistOptions?.addEventListener("click", wishlistOptionsListener);
  wishlistCreateButton?.addEventListener("click", wishlistCreateListener);
  wishlistDialog?.addEventListener("close", closeWishlistDialog);
  map.on("load", handleLoad);
  map.on("error", handleMapError);

  if (drawToSearchEnabled && drawControls) {
    drawControls.drawToggle.addEventListener("click", handleDrawToggleClick);
    drawControls.clearDrawing.addEventListener(
      "click",
      handleClearDrawingClick,
    );
    drawControls.drawingOverlay.addEventListener("pointerdown", startDrawing);
    drawControls.drawingOverlay.addEventListener("pointermove", extendDrawing);
    drawControls.drawingOverlay.addEventListener("pointerup", finishDrawing);
    drawControls.drawingOverlay.addEventListener(
      "pointercancel",
      finishDrawing,
    );
    window.addEventListener("keydown", handleWindowKeydown);
    syncDrawUi();
  }

  return () => {
    if (isDestroyed) {
      return;
    }

    isDestroyed = true;
    refreshListings.cancel();
    abortController?.abort();
    activePopup?.remove();
    clearPointerCursor();
    setMapInteractionsEnabled(true);
    clearPriceMarkers();

    map.off("load", handleLoad);
    map.off("error", handleMapError);
    map.off("moveend", handleMoveEnd);
    map.off("click", CLUSTERS_LAYER_ID, handleClusterClick);
    map.off("click", UNCLUSTERED_LAYER_ID, handlePointClick);
    map.off("mouseenter", CLUSTERS_LAYER_ID, setPointerCursor);
    map.off("mouseleave", CLUSTERS_LAYER_ID, clearPointerCursor);
    map.off("mouseenter", UNCLUSTERED_LAYER_ID, setPointerCursor);
    map.off("mouseleave", UNCLUSTERED_LAYER_ID, clearPointerCursor);
    listItems.removeEventListener("click", handleListClick);
    wishlistOptions?.removeEventListener("click", wishlistOptionsListener);
    wishlistCreateButton?.removeEventListener("click", wishlistCreateListener);
    wishlistOptions?.replaceChildren();
    wishlistDialog?.removeEventListener("close", closeWishlistDialog);

    if (drawToSearchEnabled && drawControls) {
      drawControls.drawToggle.removeEventListener(
        "click",
        handleDrawToggleClick,
      );
      drawControls.clearDrawing.removeEventListener(
        "click",
        handleClearDrawingClick,
      );
      drawControls.drawingOverlay.removeEventListener(
        "pointerdown",
        startDrawing,
      );
      drawControls.drawingOverlay.removeEventListener(
        "pointermove",
        extendDrawing,
      );
      drawControls.drawingOverlay.removeEventListener(
        "pointerup",
        finishDrawing,
      );
      drawControls.drawingOverlay.removeEventListener(
        "pointercancel",
        finishDrawing,
      );
      window.removeEventListener("keydown", handleWindowKeydown);
    }

    map.remove();
    releasePmtilesProtocol();
  };
}
