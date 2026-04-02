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

const DEFAULT_CENTER: [number, number] = [19.1451, 51.9194];
const DEFAULT_ZOOM = 6;
const DEFAULT_PMTILES_URL =
  "https://pub-bfaa61c41d364f489c3ef9b268baf004.r2.dev/poland.pmtiles";
const DEFAULT_LISTINGS_API_URL = "/api/listings";
const PROTOMAPS_SOURCE_ID = "protomaps";
const LISTINGS_SOURCE_ID = "listings";
const CLUSTERS_LAYER_ID = "listing-clusters";
const CLUSTER_COUNT_LAYER_ID = "listing-cluster-count";
const UNCLUSTERED_LAYER_ID = "listing-points";
const PLACEHOLDER_THUMBNAIL = "/listing-placeholder.svg";
const POPUP_CURRENCY = new Intl.NumberFormat("pl-PL", {
  style: "currency",
  currency: "PLN",
  maximumFractionDigits: 0,
});

type ListingProperties = {
  id: number;
  slug: string;
  title: string;
  price: number;
  rooms: number;
  transactionType: string;
  thumbnailUrl: string;
  city: string;
  street: string;
};

type ListingFeature = {
  type: "Feature";
  geometry: {
    type: "Point";
    coordinates: [number, number];
  };
  properties: ListingProperties;
};

type ListingFeatureCollection = {
  type: "FeatureCollection";
  features: ListingFeature[];
};

const EMPTY_FEATURE_COLLECTION: ListingFeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

const FOCUSED_LISTING_ZOOM = 13;

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

function formatPrice(price: number): string {
  if (!Number.isFinite(price)) {
    return "Cena niedostępna";
  }

  return POPUP_CURRENCY.format(price);
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

  const price = document.createElement("span");
  price.textContent = formatPrice(properties.price);

  const rooms = document.createElement("span");
  rooms.textContent = formatRooms(properties.rooms);

  details.appendChild(price);
  details.appendChild(rooms);
  body.appendChild(eyebrow);
  body.appendChild(title);
  body.appendChild(meta);
  body.appendChild(details);
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

  const eyebrow = document.createElement("div");
  eyebrow.className = "listing-map__card-eyebrow";
  eyebrow.textContent = formatTransactionType(feature.properties.transactionType);

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

  card.appendChild(eyebrow);
  card.appendChild(title);
  card.appendChild(meta);
  card.appendChild(location);
  return card;
}

function buildListingsUrl(endpoint: string, map: maplibregl.Map): string {
  const bounds = map.getBounds();
  const bbox = [
    bounds.getWest(),
    bounds.getSouth(),
    bounds.getEast(),
    bounds.getNorth(),
  ]
    .map((value) => value.toFixed(6))
    .join(",");

  const url = new URL(endpoint, window.location.origin);
  url.searchParams.set("bbox", bbox);
  return url.toString();
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

  if (!canvas || !listItems || !emptyState || !listSummary) {
    throw new Error("Listing map canvas is missing");
  }

  const initialCenter = parseCenter(root.dataset.initialCenter);
  const initialZoom = parseZoom(root.dataset.initialZoom);
  const pmtilesUrl = root.dataset.pmtilesUrl || DEFAULT_PMTILES_URL;
  const listingsApiUrl =
    root.dataset.listingsApiUrl || DEFAULT_LISTINGS_API_URL;

  acquirePmtilesProtocol();

  let activePopup: Popup | null = null;
  let abortController: AbortController | null = null;
  let isDestroyed = false;
  let activeListingId: number | null = null;
  const featuresById = new Map<number, ListingFeature>();

  const map = new maplibregl.Map({
    container: canvas,
    style: createMapStyle(pmtilesUrl),
    center: initialCenter,
    zoom: initialZoom,
  });

  map.addControl(new maplibregl.NavigationControl(), "top-right");

  const setStatus = (message: string | null) => {
    if (!status) {
      return;
    }

    if (!message) {
      status.textContent = "";
      status.hidden = true;
      root.dataset.status = "idle";
      return;
    }

    status.hidden = false;
    status.textContent = message;
    root.dataset.status = "error";
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

  const renderListingList = (features: ListingFeature[]) => {
    listItems.replaceChildren();
    emptyState.hidden = features.length > 0;

    if (features.length === 0) {
      setListSummary("Przesuń mapę, aby wyszukać oferty w innej okolicy.");
      setActiveListing(null);
      return;
    }

    setListSummary(
      `${features.length} ${formatOfferCountLabel(features.length)} w aktualnym widoku`,
    );

    const fragment = document.createDocumentFragment();
    for (const feature of features) {
      fragment.appendChild(createListingCard(feature));
    }

    listItems.appendChild(fragment);
    setActiveListing(activeListingId);
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
      const response = await fetch(buildListingsUrl(listingsApiUrl, map), {
        headers: {
          accept: "application/json",
        },
        signal: abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`Listing fetch failed with ${response.status}`);
      }

      const payload = normalizeFeatureCollection(await response.json());
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

      setStatus(null);
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
        "circle-radius": 7,
        "circle-stroke-width": 2,
        "circle-stroke-color": "#ffffff",
      },
    });

    map.on("click", CLUSTERS_LAYER_ID, handleClusterClick);
    map.on("click", UNCLUSTERED_LAYER_ID, handlePointClick);
    map.on("mouseenter", CLUSTERS_LAYER_ID, setPointerCursor);
    map.on("mouseleave", CLUSTERS_LAYER_ID, clearPointerCursor);
    map.on("mouseenter", UNCLUSTERED_LAYER_ID, setPointerCursor);
    map.on("mouseleave", UNCLUSTERED_LAYER_ID, clearPointerCursor);
    map.on("moveend", refreshListings);

    await fetchListings();
  };

  const handleListClick = (event: Event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
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

  listItems.addEventListener("click", handleListClick);
  map.on("load", handleLoad);
  map.on("error", handleMapError);

  return () => {
    if (isDestroyed) {
      return;
    }

    isDestroyed = true;
    refreshListings.cancel();
    abortController?.abort();
    activePopup?.remove();
    clearPointerCursor();

    map.off("load", handleLoad);
    map.off("error", handleMapError);
    map.off("moveend", refreshListings);
    map.off("click", CLUSTERS_LAYER_ID, handleClusterClick);
    map.off("click", UNCLUSTERED_LAYER_ID, handlePointClick);
    map.off("mouseenter", CLUSTERS_LAYER_ID, setPointerCursor);
    map.off("mouseleave", CLUSTERS_LAYER_ID, clearPointerCursor);
    map.off("mouseenter", UNCLUSTERED_LAYER_ID, setPointerCursor);
    map.off("mouseleave", UNCLUSTERED_LAYER_ID, clearPointerCursor);
    listItems.removeEventListener("click", handleListClick);
    map.remove();
    releasePmtilesProtocol();
  };
}
