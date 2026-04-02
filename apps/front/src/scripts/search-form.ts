type LocationSuggestion = {
  label: string;
  lat: number;
  lon: number;
  bbox: string;
  kind: string;
};

type GeocodeResponse = {
  suggestions?: LocationSuggestion[];
  error?: {
    code: string;
    message: string;
  };
};

const mountedForms = new WeakMap<HTMLFormElement, () => void>();
let lifecycleRegistered = false;

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

function formatPriceValue(value: string): string {
  const digits = value.replace(/\D+/g, "");
  if (!digits) {
    return "";
  }

  return new Intl.NumberFormat("pl-PL").format(Number(digits));
}

function sanitizePriceValue(value: string): string {
  return value.replace(/\D+/g, "");
}

function formatSuggestionKind(kind: string): string {
  if (kind === "city") {
    return "Miasto";
  }

  if (kind === "district") {
    return "Dzielnica";
  }

  if (kind === "street") {
    return "Ulica";
  }

  if (kind === "house") {
    return "Adres";
  }

  return kind;
}

function createSuggestionPanel() {
  const panel = document.createElement("div");
  panel.className = "location-search__panel";
  panel.hidden = true;

  const status = document.createElement("div");
  status.className = "location-search__status";
  status.hidden = true;

  const list = document.createElement("div");
  list.className = "location-search__list";
  list.setAttribute("role", "listbox");

  panel.appendChild(status);
  panel.appendChild(list);
  document.body.appendChild(panel);

  return { panel, status, list };
}

function mountSearchModule(root: HTMLFormElement): () => void {
  const transactionInput = root.querySelector<HTMLInputElement>(
    "[data-transaction-input]",
  );
  const categoryInput = root.querySelector<HTMLInputElement>(
    "[data-category-input]",
  );
  const propertyTypeSelect = root.querySelector(
    "[data-property-type-select]",
  ) as HTMLSelectElement | null;
  const toggles = Array.from(
    root.querySelectorAll<HTMLButtonElement>("[data-transaction-toggle]"),
  );
  const priceInputs = Array.from(
    root.querySelectorAll<HTMLInputElement>("[data-price-input]"),
  );
  const locationField = root.querySelector<HTMLElement>("[data-location-field]");
  const locationInput = root.querySelector<HTMLInputElement>("[data-location-input]");
  const locationLatInput = root.querySelector<HTMLInputElement>(
    "[data-location-lat-input]",
  );
  const locationLonInput = root.querySelector<HTMLInputElement>(
    "[data-location-lon-input]",
  );
  const locationBboxInput = root.querySelector<HTMLInputElement>(
    "[data-location-bbox-input]",
  );

  const placeholderPresets: Record<string, { min: string; max: string }> = {
    sale: {
      min: "np. 450 000",
      max: "np. 1 250 000",
    },
    rent: {
      min: "np. 2 000",
      max: "np. 6 500",
    },
  };

  const categoryMap: Record<string, string> = {
    apartment: "1",
    house: "2",
    plot: "3",
    room: "",
    "": "",
  };

  if (!locationField || !locationInput) {
    throw new Error("Search module location input is missing");
  }

  const { panel, status, list } = createSuggestionPanel();
  const listId = `location-search-list-${Math.random().toString(36).slice(2, 9)}`;
  list.id = listId;
  locationInput.setAttribute("aria-autocomplete", "list");
  locationInput.setAttribute("aria-controls", listId);
  locationInput.setAttribute("aria-expanded", "false");

  let selectedSuggestion: LocationSuggestion | null = null;
  let suggestions: LocationSuggestion[] = [];
  let activeSuggestionIndex = -1;
  let abortController: AbortController | null = null;
  let requestError: string | null = null;
  let isDestroyed = false;

  const updatePanelPosition = () => {
    const rect = locationField.getBoundingClientRect();
    panel.style.left = `${Math.round(rect.left)}px`;
    panel.style.top = `${Math.round(rect.bottom + 8)}px`;
    panel.style.width = `${Math.round(rect.width)}px`;
  };

  const closePanel = () => {
    panel.hidden = true;
    panel.dataset.state = "";
    locationInput.setAttribute("aria-expanded", "false");
  };

  const openPanel = () => {
    updatePanelPosition();
    panel.hidden = false;
    locationInput.setAttribute("aria-expanded", "true");
  };

  const setPanelStatus = (
    message: string | null,
    panelState: "" | "loading" | "empty" | "error" = "",
  ) => {
    if (!message) {
      status.hidden = true;
      status.textContent = "";
      status.dataset.state = "";
      return;
    }

    status.hidden = false;
    status.textContent = message;
    status.dataset.state = panelState;
  };

  const syncHiddenLocationInputs = (suggestion: LocationSuggestion | null) => {
    const updates: Array<[HTMLInputElement | null, string]> = [
      [locationLatInput, suggestion ? String(suggestion.lat) : ""],
      [locationLonInput, suggestion ? String(suggestion.lon) : ""],
      [locationBboxInput, suggestion ? suggestion.bbox : ""],
    ];

    for (const [input, value] of updates) {
      if (!input) {
        continue;
      }

      input.value = value;
      input.disabled = value.length === 0;
    }
  };

  const clearSelection = () => {
    selectedSuggestion = null;
    syncHiddenLocationInputs(null);
  };

  const selectSuggestion = (suggestion: LocationSuggestion) => {
    selectedSuggestion = suggestion;
    locationInput.value = suggestion.label;
    syncHiddenLocationInputs(suggestion);
    requestError = null;
    suggestions = [];
    activeSuggestionIndex = -1;
    list.replaceChildren();
    setPanelStatus(null);
    closePanel();
  };

  const renderSuggestions = () => {
    list.replaceChildren();

    if (suggestions.length === 0) {
      if (requestError) {
        panel.dataset.state = "error";
        setPanelStatus(requestError, "error");
        openPanel();
        return;
      }

      panel.dataset.state = "empty";
      setPanelStatus("Nie znalezlismy lokalizacji dla tego zapytania.", "empty");
      openPanel();
      return;
    }

    panel.dataset.state = "results";
    setPanelStatus(null);

    suggestions.forEach((suggestion, index) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "location-search__item";
      item.setAttribute("role", "option");
      item.setAttribute(
        "aria-selected",
        index === activeSuggestionIndex ? "true" : "false",
      );
      item.dataset.index = String(index);
      item.classList.toggle("is-active", index === activeSuggestionIndex);

      const label = document.createElement("span");
      label.className = "location-search__item-label";
      label.textContent = suggestion.label;

      const meta = document.createElement("span");
      meta.className = "location-search__item-meta";
      meta.textContent = formatSuggestionKind(suggestion.kind);

      item.appendChild(label);
      item.appendChild(meta);
      item.addEventListener("mousedown", (event) => {
        event.preventDefault();
      });
      item.addEventListener("click", () => {
        selectSuggestion(suggestion);
      });

      list.appendChild(item);
    });

    openPanel();
  };

  const syncSuggestionHighlight = () => {
    Array.from(list.querySelectorAll<HTMLButtonElement>(".location-search__item"))
      .forEach((item) => {
        const itemIndex = Number(item.dataset.index);
        const isActive = itemIndex === activeSuggestionIndex;
        item.classList.toggle("is-active", isActive);
        item.setAttribute("aria-selected", isActive ? "true" : "false");

        if (isActive) {
          item.scrollIntoView({ block: "nearest" });
        }
      });
  };

  const fetchSuggestions = debounce(async () => {
    const query = locationInput.value.trim();

    if (query.length < 2) {
      abortController?.abort();
      requestError = null;
      suggestions = [];
      activeSuggestionIndex = -1;
      setPanelStatus(null);
      closePanel();
      return;
    }

    abortController?.abort();
    abortController = new AbortController();
    requestError = null;
    suggestions = [];
    activeSuggestionIndex = -1;
    panel.dataset.state = "loading";
    setPanelStatus("Szukamy lokalizacji...", "loading");
    openPanel();

    try {
      const response = await fetch(
        `/api/geocode?q=${encodeURIComponent(query)}&limit=5`,
        {
          headers: {
            accept: "application/json",
          },
          signal: abortController.signal,
        },
      );
      const payload = (await response.json()) as GeocodeResponse;

      if (!response.ok) {
        throw new Error(
          payload.error?.message ??
            "Lokalny geokoder jest chwilowo niedostepny.",
        );
      }

      suggestions = Array.isArray(payload.suggestions) ? payload.suggestions : [];
      activeSuggestionIndex = suggestions.length > 0 ? 0 : -1;
      renderSuggestions();
      syncSuggestionHighlight();
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }

      console.error("Failed to fetch search suggestions", error);
      requestError =
        error instanceof Error && error.message
          ? error.message
          : "Lokalny geokoder jest chwilowo niedostepny.";
      suggestions = [];
      activeSuggestionIndex = -1;
      renderSuggestions();
    }
  }, 220);

  const hasValidLocationSelection = () => {
    return Boolean(
      selectedSuggestion &&
        locationLatInput?.value &&
        locationLonInput?.value &&
        locationBboxInput?.value,
    );
  };

  const syncCategoryInput = () => {
    if (
      !(categoryInput instanceof HTMLInputElement) ||
      !(propertyTypeSelect instanceof HTMLSelectElement)
    ) {
      return;
    }

    const categoryId = categoryMap[propertyTypeSelect.value] ?? "";
    categoryInput.value = categoryId;
    categoryInput.disabled = categoryId === "";
  };

  const setTransaction = (value: string) => {
    if (!(transactionInput instanceof HTMLInputElement)) {
      return;
    }

    transactionInput.value = value;

    toggles.forEach((toggle) => {
      const isActive = toggle.dataset.value === value;
      toggle.dataset.active = isActive ? "true" : "false";
      toggle.setAttribute("aria-pressed", String(isActive));
    });

    priceInputs.forEach((input) => {
      const kind = input.dataset.priceKind;
      if (kind !== "min" && kind !== "max") {
        return;
      }

      input.placeholder = placeholderPresets[value]?.[kind] ?? input.placeholder;
    });
  };

  const handleDocumentPointerDown = (event: PointerEvent) => {
    const target = event.target;
    if (!(target instanceof Node)) {
      return;
    }

    if (locationField.contains(target) || panel.contains(target)) {
      return;
    }

    closePanel();
  };

  const handleLocationInput = () => {
    if (
      selectedSuggestion &&
      locationInput.value.trim() !== selectedSuggestion.label
    ) {
      clearSelection();
    }

    fetchSuggestions();
  };

  const handleLocationFocus = () => {
    if (suggestions.length > 0 || requestError) {
      renderSuggestions();
      syncSuggestionHighlight();
      return;
    }

    if (locationInput.value.trim().length >= 2) {
      fetchSuggestions();
    }
  };

  const handleLocationKeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      closePanel();
      return;
    }

    if (suggestions.length === 0) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      activeSuggestionIndex =
        activeSuggestionIndex >= suggestions.length - 1
          ? 0
          : activeSuggestionIndex + 1;
      openPanel();
      syncSuggestionHighlight();
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      activeSuggestionIndex =
        activeSuggestionIndex <= 0
          ? suggestions.length - 1
          : activeSuggestionIndex - 1;
      openPanel();
      syncSuggestionHighlight();
      return;
    }

    if (event.key === "Enter" && !panel.hidden && activeSuggestionIndex >= 0) {
      event.preventDefault();
      const suggestion = suggestions[activeSuggestionIndex];
      if (suggestion) {
        selectSuggestion(suggestion);
      }
    }
  };

  const handleSubmit = (event: SubmitEvent) => {
    const locationValue = locationInput.value.trim();

    if (locationValue.length > 0 && !hasValidLocationSelection()) {
      event.preventDefault();
      requestError =
        requestError ??
        "Wybierz lokalizacje z listy podpowiedzi, aby kontynuowac.";
      suggestions = [];
      activeSuggestionIndex = -1;
      renderSuggestions();
      locationInput.focus();
      return;
    }

    priceInputs.forEach((input) => {
      input.value = sanitizePriceValue(input.value);
    });
  };

  const toggleClickHandlers = new Map<HTMLButtonElement, () => void>();

  toggles.forEach((toggle) => {
    const handleToggleClick = () => {
      const value = toggle.dataset.value;
      if (!value) {
        return;
      }

      setTransaction(value);
    };

    toggleClickHandlers.set(toggle, handleToggleClick);
    toggle.addEventListener("click", handleToggleClick);
  });

  if (propertyTypeSelect instanceof HTMLSelectElement) {
    propertyTypeSelect.addEventListener("change", syncCategoryInput);
    syncCategoryInput();
  }

  priceInputs.forEach((input) => {
    input.addEventListener("input", () => {
      input.value = formatPriceValue(input.value);
    });

    input.addEventListener("blur", () => {
      input.value = formatPriceValue(input.value);
    });
  });

  locationInput.addEventListener("input", handleLocationInput);
  locationInput.addEventListener("focus", handleLocationFocus);
  locationInput.addEventListener("keydown", handleLocationKeydown);
  root.addEventListener("submit", handleSubmit);
  document.addEventListener("pointerdown", handleDocumentPointerDown);
  window.addEventListener("resize", updatePanelPosition);
  window.addEventListener("scroll", updatePanelPosition, true);

  if (
    locationInput.value.trim().length > 0 &&
    locationLatInput?.value &&
    locationLonInput?.value &&
    locationBboxInput?.value
  ) {
    selectedSuggestion = {
      label: locationInput.value.trim(),
      lat: Number(locationLatInput.value),
      lon: Number(locationLonInput.value),
      bbox: locationBboxInput.value,
      kind: "selected",
    };
  } else {
    syncHiddenLocationInputs(null);
  }

  if (transactionInput instanceof HTMLInputElement) {
    setTransaction(transactionInput.value || "sale");
  }

  return () => {
    if (isDestroyed) {
      return;
    }

    isDestroyed = true;
    fetchSuggestions.cancel();
    abortController?.abort();
    panel.remove();
    document.removeEventListener("pointerdown", handleDocumentPointerDown);
    window.removeEventListener("resize", updatePanelPosition);
    window.removeEventListener("scroll", updatePanelPosition, true);
    root.removeEventListener("submit", handleSubmit);
    locationInput.removeEventListener("input", handleLocationInput);
    locationInput.removeEventListener("focus", handleLocationFocus);
    locationInput.removeEventListener("keydown", handleLocationKeydown);
    toggles.forEach((toggle) => {
      const handleToggleClick = toggleClickHandlers.get(toggle);
      if (handleToggleClick) {
        toggle.removeEventListener("click", handleToggleClick);
      }
    });
  };
}

function setupSearchModules() {
  document.querySelectorAll("[data-search-module]").forEach((node) => {
    if (!(node instanceof HTMLFormElement) || mountedForms.has(node)) {
      return;
    }

    const cleanup = mountSearchModule(node);
    mountedForms.set(node, cleanup);
  });
}

function cleanupSearchModules() {
  document.querySelectorAll("[data-search-module]").forEach((node) => {
    if (!(node instanceof HTMLFormElement)) {
      return;
    }

    const cleanup = mountedForms.get(node);
    if (!cleanup) {
      return;
    }

    cleanup();
    mountedForms.delete(node);
  });
}

export function startSearchModuleLifecycle() {
  if (lifecycleRegistered) {
    return;
  }

  lifecycleRegistered = true;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setupSearchModules, {
      once: true,
    });
  } else {
    setupSearchModules();
  }

  document.addEventListener("astro:page-load", setupSearchModules);
  document.addEventListener("astro:after-swap", setupSearchModules);
  document.addEventListener("astro:before-swap", cleanupSearchModules);
  window.addEventListener("pagehide", cleanupSearchModules, { once: true });
}
