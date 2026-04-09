import { startTransition, useEffect, useState, type FormEvent } from "react";

import type {
  AmenityResponse,
  DictionaryItem,
  ListingResponse,
  PaginatedResponse,
  ProfileResponse,
  PropertyResponse,
} from "@/lib/server/seller";

type SellerListingWizardProps = {
  apiBaseUrl: string;
  initialAmenities: PaginatedResponse<AmenityResponse>;
  initialCategories: PaginatedResponse<DictionaryItem>;
  initialProfile: ProfileResponse;
  initialVoivodeships: PaginatedResponse<DictionaryItem>;
};

type WizardStep = 1 | 2 | 3 | 4 | 5;
type SellerRole = "owner" | "agent";

const stepCopy: Record<WizardStep, { eyebrow: string; title: string; body: string }> = {
  1: {
    eyebrow: "Krok 1",
    title: "Profil sprzedającego",
    body: "Uzupełnij rolę, telefon i dane agencji, jeśli chcesz działać jako pośrednik.",
  },
  2: {
    eyebrow: "Krok 2",
    title: "Parametry nieruchomości",
    body: "Zapisz lokalizację, kategorię i najważniejsze cechy obiektu, który chcesz sprzedać.",
  },
  3: {
    eyebrow: "Krok 3",
    title: "Szkic oferty",
    body: "Ustal cenę i termin wygaśnięcia. Oferta zostanie zapisana jako szkic.",
  },
  4: {
    eyebrow: "Krok 4",
    title: "Media i dzień otwarty",
    body: "Dodaj zdjęcia po URL-ach oraz opcjonalnie termin open house przed publikacją.",
  },
  5: {
    eyebrow: "Krok 5",
    title: "Podgląd i publikacja",
    body: "Sprawdź zapisane dane i opublikuj ofertę sprzedaży.",
  },
};

function extractErrorMessage(payload: unknown, fallback: string) {
  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    payload.error &&
    typeof payload.error === "object" &&
    "message" in payload.error &&
    typeof payload.error.message === "string"
  ) {
    return payload.error.message;
  }

  return fallback;
}

function toIsoString(value: string) {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  return date.toISOString();
}

export function SellerListingWizard({
  apiBaseUrl,
  initialAmenities,
  initialCategories,
  initialProfile,
  initialVoivodeships,
}: SellerListingWizardProps) {
  const initialRole: SellerRole =
    initialProfile.business_role === "agent" ? "agent" : "owner";

  const [step, setStep] = useState<WizardStep>(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [profile, setProfile] = useState(initialProfile);
  const [selectedRole, setSelectedRole] = useState<SellerRole>(initialRole);
  const [phone, setPhone] = useState(initialProfile.phone ?? "");
  const [agencyCompanyName, setAgencyCompanyName] = useState("");
  const [agencyNip, setAgencyNip] = useState("");
  const [agencyAddress, setAgencyAddress] = useState("");

  const [voivodeshipId, setVoivodeshipId] = useState("");
  const [cityId, setCityId] = useState("");
  const [districtId, setDistrictId] = useState("");
  const [cities, setCities] = useState<DictionaryItem[]>([]);
  const [districts, setDistricts] = useState<DictionaryItem[]>([]);
  const [street, setStreet] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [buildingNumber, setBuildingNumber] = useState("");
  const [apartmentNumber, setApartmentNumber] = useState("");
  const [categoryId, setCategoryId] = useState(
    initialCategories.items[0] ? String(initialCategories.items[0].id) : "",
  );
  const [areaSqm, setAreaSqm] = useState("");
  const [plotAreaSqm, setPlotAreaSqm] = useState("");
  const [rooms, setRooms] = useState("");
  const [floor, setFloor] = useState("");
  const [yearBuilt, setYearBuilt] = useState("");
  const [heatingType, setHeatingType] = useState("district");
  const [ownershipShare, setOwnershipShare] = useState("100");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [extraAttributes, setExtraAttributes] = useState("");
  const [amenityIds, setAmenityIds] = useState<number[]>([]);

  const [property, setProperty] = useState<PropertyResponse | null>(null);
  const [listing, setListing] = useState<ListingResponse | null>(null);
  const [listingPrice, setListingPrice] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [mediaUrls, setMediaUrls] = useState("");
  const [openHouseStart, setOpenHouseStart] = useState("");
  const [openHouseEnd, setOpenHouseEnd] = useState("");
  const [openHouseRequiresRegistration, setOpenHouseRequiresRegistration] =
    useState(false);
  const [openHouseInstructions, setOpenHouseInstructions] = useState("");

  useEffect(() => {
    if (!voivodeshipId) {
      setCities([]);
      setCityId("");
      return;
    }

    const controller = new AbortController();

    void (async () => {
      try {
        const response = await fetch(
          `${apiBaseUrl}/api/v1/cities?voivodeship_id=${voivodeshipId}&per_page=100`,
          {
            credentials: "include",
            headers: { accept: "application/json" },
            signal: controller.signal,
          },
        );

        if (!response.ok) {
          throw new Error("Nie udało się pobrać listy miast.");
        }

        const payload = (await response.json()) as PaginatedResponse<DictionaryItem>;
        setCities(payload.items);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : "Nie udało się pobrać listy miast.");
        }
      }
    })();

    return () => controller.abort();
  }, [apiBaseUrl, voivodeshipId]);

  useEffect(() => {
    if (!cityId) {
      setDistricts([]);
      setDistrictId("");
      return;
    }

    const controller = new AbortController();

    void (async () => {
      try {
        const response = await fetch(
          `${apiBaseUrl}/api/v1/districts?city_id=${cityId}&per_page=100`,
          {
            credentials: "include",
            headers: { accept: "application/json" },
            signal: controller.signal,
          },
        );

        if (!response.ok) {
          throw new Error("Nie udało się pobrać listy dzielnic.");
        }

        const payload = (await response.json()) as PaginatedResponse<DictionaryItem>;
        setDistricts(payload.items);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Nie udało się pobrać listy dzielnic.",
          );
        }
      }
    })();

    return () => controller.abort();
  }, [apiBaseUrl, cityId]);

  async function requestJson<T>(
    path: string,
    init: Omit<RequestInit, "body"> & { body?: unknown } = {},
  ): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");

    let body: BodyInit | undefined;
    if (init.body !== undefined) {
      headers.set("content-type", "application/json");
      body = JSON.stringify(init.body);
    }

    const response = await fetch(`${apiBaseUrl}${path}`, {
      ...init,
      body,
      credentials: "include",
      headers,
    });

    if (!response.ok) {
      let payload: unknown = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }

      throw new Error(
        extractErrorMessage(payload, `Żądanie zakończyło się statusem ${response.status}.`),
      );
    }

    return (await response.json()) as T;
  }

  async function submitProfileStep() {
    const nextProfile = await requestJson<ProfileResponse>("/api/v1/profile", {
      method: "PATCH",
      body: {
        phone,
        business_role: selectedRole,
      },
    });

    if (
      selectedRole === "agent" &&
      !nextProfile.agency_id &&
      !profile.agency_id
    ) {
      if (!agencyCompanyName || !agencyNip || !agencyAddress) {
        throw new Error("Uzupełnij dane agencji, aby działać jako agent.");
      }

      const agency = await requestJson<{ id: number }>("/api/v1/agencies", {
        method: "POST",
        body: {
          company_name: agencyCompanyName,
          nip: agencyNip,
          address: agencyAddress,
        },
      });

      setProfile({ ...nextProfile, agency_id: agency.id });
    } else {
      setProfile(nextProfile);
    }

    setNotice("Profil wystawiającego został zapisany.");
    startTransition(() => setStep(2));
  }

  async function submitPropertyStep() {
    if (!voivodeshipId || !cityId || !street || !postalCode || !buildingNumber) {
      throw new Error("Uzupełnij lokalizację nieruchomości.");
    }

    if (!latitude || !longitude) {
      throw new Error("Podaj współrzędne nieruchomości.");
    }

    let parsedAttributes: Record<string, unknown> | undefined;
    if (extraAttributes.trim()) {
      const raw = JSON.parse(extraAttributes) as unknown;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new Error("Dodatkowe atrybuty muszą być poprawnym obiektem JSON.");
      }
      parsedAttributes = raw as Record<string, unknown>;
    }

    const createdProperty = await requestJson<PropertyResponse>("/api/v1/properties", {
      method: "POST",
      body: {
        location: {
          city_id: Number(cityId),
          district_id: districtId ? Number(districtId) : null,
          street,
          postal_code: postalCode,
          building_number: buildingNumber,
          apartment_number: apartmentNumber || null,
          latitude: Number(latitude),
          longitude: Number(longitude),
        },
        category_id: Number(categoryId),
        area_sqm: Number(areaSqm),
        plot_area_sqm: plotAreaSqm ? Number(plotAreaSqm) : null,
        rooms: Number(rooms),
        floor: Number(floor),
        year_built: Number(yearBuilt),
        heating_type: heatingType,
        amenity_ids: amenityIds,
        owners: [
          {
            user_id: profile.id,
            ownership_share: ownershipShare ? Number(ownershipShare) : null,
          },
        ],
        extra_attributes: parsedAttributes ?? {},
      },
    });

    setProperty(createdProperty);
    setNotice("Nieruchomość została zapisana.");
    startTransition(() => setStep(3));
  }

  async function submitListingStep() {
    if (!property) {
      throw new Error("Najpierw zapisz nieruchomość.");
    }

    if (!listingPrice) {
      throw new Error("Ustaw cenę oferty.");
    }

    const createdListing = await requestJson<ListingResponse>("/api/v1/listings", {
      method: "POST",
      body: {
        property_id: property.id,
        transaction_type: "sale",
        price: Number(listingPrice),
        status: "draft",
        expires_at: toIsoString(expiresAt),
      },
    });

    setListing(createdListing);
    setNotice("Szkic oferty został zapisany.");
    startTransition(() => setStep(4));
  }

  async function submitAssetsStep() {
    if (!listing) {
      throw new Error("Najpierw utwórz szkic oferty.");
    }

    const urls = mediaUrls
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean);

    for (const [index, url] of urls.entries()) {
      await requestJson(`/api/v1/listings/${listing.id}/media`, {
        method: "POST",
        body: {
          media_type: "photo",
          url,
          is_main: index === 0,
          sort_order: index,
        },
      });
    }

    if (openHouseStart && openHouseEnd) {
      await requestJson(`/api/v1/listings/${listing.id}/open-houses`, {
        method: "POST",
        body: {
          start_time: toIsoString(openHouseStart),
          end_time: toIsoString(openHouseEnd),
          requires_registration: openHouseRequiresRegistration,
          instructions: openHouseInstructions,
        },
      });
    }

    const refreshedListing = await requestJson<ListingResponse>(
      `/api/v1/listings/${listing.id}`,
      { method: "GET" },
    );
    setListing(refreshedListing);
    setNotice("Media i wydarzenia zostały zapisane.");
    startTransition(() => setStep(5));
  }

  async function publishListing() {
    if (!listing) {
      throw new Error("Brak szkicu do publikacji.");
    }

    const published = await requestJson<ListingResponse>(`/api/v1/listings/${listing.id}`, {
      method: "PATCH",
      body: {
        status: "active",
      },
    });

    setListing(published);
    setNotice("Oferta została opublikowana. Przenoszę do listy ofert.");
    window.location.href = `/dashboard/oferty?status=active&created=${published.id}`;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setIsSubmitting(true);

    try {
      if (step === 1) {
        await submitProfileStep();
      } else if (step === 2) {
        await submitPropertyStep();
      } else if (step === 3) {
        await submitListingStep();
      } else if (step === 4) {
        await submitAssetsStep();
      } else {
        await publishListing();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Nie udało się zapisać kroku.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function goBack() {
    if (step === 1 || isSubmitting) {
      return;
    }

    startTransition(() => setStep((step - 1) as WizardStep));
  }

  function toggleAmenity(id: number) {
    setAmenityIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  const stepMeta = stepCopy[step];
  const orderedSteps: WizardStep[] = [1, 2, 3, 4, 5];

  return (
    <div className="grid gap-6 xl:grid-cols-[0.88fr_1.12fr]">
      <aside className="rounded-[2rem] border border-black/8 bg-white/86 p-5 shadow-[0_18px_40px_rgba(42,33,23,0.06)]">
        <p className="font-primary text-[0.64rem] uppercase tracking-[0.24em] text-[#8a7760]">
          Proces wystawienia
        </p>
        <h2 className="mt-2 font-secondary text-xl font-semibold text-[#19150f]">
          Sprzedaż krok po kroku
        </h2>
        <div className="mt-5 space-y-3">
          {orderedSteps.map((item) => (
            <div
              key={item}
              className={[
                "rounded-[1.4rem] border px-4 py-4 transition-colors",
                item === step
                  ? "border-black/10 bg-[#19150f] text-white"
                  : "border-black/7 bg-[#fbf8f4] text-[#2c251e]",
              ].join(" ")}
            >
              <p
                className={[
                  "font-primary text-[0.62rem] uppercase tracking-[0.2em]",
                  item === step ? "text-white/70" : "text-[#8a7760]",
                ].join(" ")}
              >
                {stepCopy[item].eyebrow}
              </p>
              <p className="mt-2 font-secondary text-sm font-semibold">{stepCopy[item].title}</p>
              <p
                className={[
                  "mt-2 font-secondary text-xs",
                  item === step ? "text-white/80" : "text-[#6f6254]",
                ].join(" ")}
              >
                {stepCopy[item].body}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-6 rounded-[1.4rem] border border-black/7 bg-[#fbf8f4] px-4 py-4">
          <p className="font-primary text-[0.62rem] uppercase tracking-[0.2em] text-[#8a7760]">
            Stan zapisu
          </p>
          <dl className="mt-3 space-y-2 font-secondary text-sm text-[#2b241d]">
            <div className="flex items-center justify-between gap-4">
              <dt>Profil</dt>
              <dd>{profile.business_role}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt>Nieruchomość</dt>
              <dd>{property ? `#${property.id}` : "brak"}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt>Oferta</dt>
              <dd>{listing ? `${listing.status} · #${listing.id}` : "brak"}</dd>
            </div>
          </dl>
        </div>
      </aside>

      <section className="rounded-[2rem] border border-black/8 bg-white/86 p-5 shadow-[0_18px_40px_rgba(42,33,23,0.06)]">
        <p className="font-primary text-[0.64rem] uppercase tracking-[0.24em] text-[#8a7760]">
          {stepMeta.eyebrow}
        </p>
        <h2 className="mt-2 font-secondary text-[1.8rem] font-semibold tracking-[-0.04em] text-[#17130f]">
          {stepMeta.title}
        </h2>
        <p className="mt-3 max-w-2xl font-secondary text-sm text-[#665a4e]">
          {stepMeta.body}
        </p>

        {error && (
          <div className="mt-5 rounded-[1.2rem] border border-[#d0a06a]/40 bg-[#fff4e8] px-4 py-3 font-secondary text-sm text-[#7a4f1c]">
            {error}
          </div>
        )}
        {notice && (
          <div className="mt-5 rounded-[1.2rem] border border-[#cde3d2] bg-[#edf8ef] px-4 py-3 font-secondary text-sm text-[#2f6e45]">
            {notice}
          </div>
        )}

        <form className="mt-6 space-y-6" onSubmit={(event) => void handleSubmit(event)}>
          {step === 1 && (
            <div className="space-y-6">
              <div className="grid gap-3 sm:grid-cols-2">
                {(["owner", "agent"] as SellerRole[]).map((role) => {
                  const active = selectedRole === role;
                  return (
                    <button
                      key={role}
                      className={[
                        "rounded-[1.4rem] border px-4 py-4 text-left transition-all",
                        active
                          ? "border-black/10 bg-[#19150f] text-white"
                          : "border-black/8 bg-[#fbf8f4] text-[#2c251e]",
                      ].join(" ")}
                      onClick={(event) => {
                        event.preventDefault();
                        setSelectedRole(role);
                      }}
                      type="button"
                    >
                      <p className="font-secondary text-sm font-semibold">
                        {role === "owner" ? "Właściciel prywatny" : "Agent / pośrednik"}
                      </p>
                      <p
                        className={[
                          "mt-2 font-secondary text-xs",
                          active ? "text-white/80" : "text-[#6f6254]",
                        ].join(" ")}
                      >
                        {role === "owner"
                          ? "Sprzedajesz nieruchomość we własnym imieniu."
                          : "Prowadzisz sprzedaż jako pośrednik w imieniu klienta."}
                      </p>
                    </button>
                  );
                })}
              </div>

              <label className="block">
                <span className="mb-2 block font-primary text-[0.62rem] uppercase tracking-[0.2em] text-[#8a7760]">
                  Telefon kontaktowy
                </span>
                <input
                  className="h-12 w-full rounded-[1rem] border border-black/10 bg-[#fbf8f4] px-4 font-secondary text-sm outline-none transition-colors focus:border-[#19150f]"
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="+48 500 000 000"
                  type="tel"
                  value={phone}
                />
              </label>

              {selectedRole === "agent" && !profile.agency_id && (
                <div className="grid gap-4 rounded-[1.5rem] border border-black/8 bg-[#fbf8f4] p-4 md:grid-cols-3">
                  <label className="block">
                    <span className="mb-2 block font-primary text-[0.62rem] uppercase tracking-[0.2em] text-[#8a7760]">
                      Nazwa agencji
                    </span>
                    <input
                      className="h-11 w-full rounded-[0.9rem] border border-black/10 bg-white px-3 font-secondary text-sm outline-none focus:border-[#19150f]"
                      onChange={(event) => setAgencyCompanyName(event.target.value)}
                      value={agencyCompanyName}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-2 block font-primary text-[0.62rem] uppercase tracking-[0.2em] text-[#8a7760]">
                      NIP
                    </span>
                    <input
                      className="h-11 w-full rounded-[0.9rem] border border-black/10 bg-white px-3 font-secondary text-sm outline-none focus:border-[#19150f]"
                      onChange={(event) => setAgencyNip(event.target.value)}
                      value={agencyNip}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-2 block font-primary text-[0.62rem] uppercase tracking-[0.2em] text-[#8a7760]">
                      Adres
                    </span>
                    <input
                      className="h-11 w-full rounded-[0.9rem] border border-black/10 bg-white px-3 font-secondary text-sm outline-none focus:border-[#19150f]"
                      onChange={(event) => setAgencyAddress(event.target.value)}
                      value={agencyAddress}
                    />
                  </label>
                </div>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6">
              <div className="grid gap-4 md:grid-cols-3">
                <label className="block">
                  <span className="mb-2 block font-primary text-[0.62rem] uppercase tracking-[0.2em] text-[#8a7760]">
                    Województwo
                  </span>
                  <select
                    className="h-12 w-full rounded-[1rem] border border-black/10 bg-[#fbf8f4] px-4 font-secondary text-sm outline-none focus:border-[#19150f]"
                    onChange={(event) => setVoivodeshipId(event.target.value)}
                    value={voivodeshipId}
                  >
                    <option value="">Wybierz województwo</option>
                    {initialVoivodeships.items.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-2 block font-primary text-[0.62rem] uppercase tracking-[0.2em] text-[#8a7760]">
                    Miasto
                  </span>
                  <select
                    className="h-12 w-full rounded-[1rem] border border-black/10 bg-[#fbf8f4] px-4 font-secondary text-sm outline-none focus:border-[#19150f]"
                    onChange={(event) => setCityId(event.target.value)}
                    value={cityId}
                  >
                    <option value="">Wybierz miasto</option>
                    {cities.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-2 block font-primary text-[0.62rem] uppercase tracking-[0.2em] text-[#8a7760]">
                    Dzielnica
                  </span>
                  <select
                    className="h-12 w-full rounded-[1rem] border border-black/10 bg-[#fbf8f4] px-4 font-secondary text-sm outline-none focus:border-[#19150f]"
                    onChange={(event) => setDistrictId(event.target.value)}
                    value={districtId}
                  >
                    <option value="">Bez dzielnicy</option>
                    {districts.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <label className="block xl:col-span-2">
                  <span className="mb-2 block font-primary text-[0.62rem] uppercase tracking-[0.2em] text-[#8a7760]">
                    Ulica
                  </span>
                  <input
                    className="h-12 w-full rounded-[1rem] border border-black/10 bg-[#fbf8f4] px-4 font-secondary text-sm outline-none focus:border-[#19150f]"
                    onChange={(event) => setStreet(event.target.value)}
                    value={street}
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block font-primary text-[0.62rem] uppercase tracking-[0.2em] text-[#8a7760]">
                    Kod pocztowy
                  </span>
                  <input
                    className="h-12 w-full rounded-[1rem] border border-black/10 bg-[#fbf8f4] px-4 font-secondary text-sm outline-none focus:border-[#19150f]"
                    onChange={(event) => setPostalCode(event.target.value)}
                    value={postalCode}
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block font-primary text-[0.62rem] uppercase tracking-[0.2em] text-[#8a7760]">
                    Numer budynku
                  </span>
                  <input
                    className="h-12 w-full rounded-[1rem] border border-black/10 bg-[#fbf8f4] px-4 font-secondary text-sm outline-none focus:border-[#19150f]"
                    onChange={(event) => setBuildingNumber(event.target.value)}
                    value={buildingNumber}
                  />
                </label>
              </div>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <label className="block">
                  <span className="mb-2 block font-primary text-[0.62rem] uppercase tracking-[0.2em] text-[#8a7760]">
                    Numer lokalu
                  </span>
                  <input
                    className="h-12 w-full rounded-[1rem] border border-black/10 bg-[#fbf8f4] px-4 font-secondary text-sm outline-none focus:border-[#19150f]"
                    onChange={(event) => setApartmentNumber(event.target.value)}
                    value={apartmentNumber}
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block font-primary text-[0.62rem] uppercase tracking-[0.2em] text-[#8a7760]">
                    Latitude
                  </span>
                  <input
                    className="h-12 w-full rounded-[1rem] border border-black/10 bg-[#fbf8f4] px-4 font-secondary text-sm outline-none focus:border-[#19150f]"
                    onChange={(event) => setLatitude(event.target.value)}
                    type="number"
                    value={latitude}
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block font-primary text-[0.62rem] uppercase tracking-[0.2em] text-[#8a7760]">
                    Longitude
                  </span>
                  <input
                    className="h-12 w-full rounded-[1rem] border border-black/10 bg-[#fbf8f4] px-4 font-secondary text-sm outline-none focus:border-[#19150f]"
                    onChange={(event) => setLongitude(event.target.value)}
                    type="number"
                    value={longitude}
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block font-primary text-[0.62rem] uppercase tracking-[0.2em] text-[#8a7760]">
                    Kategoria
                  </span>
                  <select
                    className="h-12 w-full rounded-[1rem] border border-black/10 bg-[#fbf8f4] px-4 font-secondary text-sm outline-none focus:border-[#19150f]"
                    onChange={(event) => setCategoryId(event.target.value)}
                    value={categoryId}
                  >
                    {initialCategories.items.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <label className="block">
                  <span className="mb-2 block font-primary text-[0.62rem] uppercase tracking-[0.2em] text-[#8a7760]">
                    Powierzchnia m²
                  </span>
                  <input
                    className="h-12 w-full rounded-[1rem] border border-black/10 bg-[#fbf8f4] px-4 font-secondary text-sm outline-none focus:border-[#19150f]"
                    onChange={(event) => setAreaSqm(event.target.value)}
                    type="number"
                    value={areaSqm}
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block font-primary text-[0.62rem] uppercase tracking-[0.2em] text-[#8a7760]">
                    Pow. działki m²
                  </span>
                  <input
                    className="h-12 w-full rounded-[1rem] border border-black/10 bg-[#fbf8f4] px-4 font-secondary text-sm outline-none focus:border-[#19150f]"
                    onChange={(event) => setPlotAreaSqm(event.target.value)}
                    type="number"
                    value={plotAreaSqm}
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block font-primary text-[0.62rem] uppercase tracking-[0.2em] text-[#8a7760]">
                    Udział własności
                  </span>
                  <input
                    className="h-12 w-full rounded-[1rem] border border-black/10 bg-[#fbf8f4] px-4 font-secondary text-sm outline-none focus:border-[#19150f]"
                    onChange={(event) => setOwnershipShare(event.target.value)}
                    type="number"
                    value={ownershipShare}
                  />
                </label>
              </div>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <label className="block">
                  <span className="mb-2 block font-primary text-[0.62rem] uppercase tracking-[0.2em] text-[#8a7760]">
                    Pokoje
                  </span>
                  <input
                    className="h-12 w-full rounded-[1rem] border border-black/10 bg-[#fbf8f4] px-4 font-secondary text-sm outline-none focus:border-[#19150f]"
                    onChange={(event) => setRooms(event.target.value)}
                    type="number"
                    value={rooms}
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block font-primary text-[0.62rem] uppercase tracking-[0.2em] text-[#8a7760]">
                    Piętro
                  </span>
                  <input
                    className="h-12 w-full rounded-[1rem] border border-black/10 bg-[#fbf8f4] px-4 font-secondary text-sm outline-none focus:border-[#19150f]"
                    onChange={(event) => setFloor(event.target.value)}
                    type="number"
                    value={floor}
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block font-primary text-[0.62rem] uppercase tracking-[0.2em] text-[#8a7760]">
                    Rok budowy
                  </span>
                  <input
                    className="h-12 w-full rounded-[1rem] border border-black/10 bg-[#fbf8f4] px-4 font-secondary text-sm outline-none focus:border-[#19150f]"
                    onChange={(event) => setYearBuilt(event.target.value)}
                    type="number"
                    value={yearBuilt}
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block font-primary text-[0.62rem] uppercase tracking-[0.2em] text-[#8a7760]">
                    Ogrzewanie
                  </span>
                  <input
                    className="h-12 w-full rounded-[1rem] border border-black/10 bg-[#fbf8f4] px-4 font-secondary text-sm outline-none focus:border-[#19150f]"
                    onChange={(event) => setHeatingType(event.target.value)}
                    value={heatingType}
                  />
                </label>
              </div>

              <div>
                <span className="mb-2 block font-primary text-[0.62rem] uppercase tracking-[0.2em] text-[#8a7760]">
                  Udogodnienia
                </span>
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {initialAmenities.items.map((amenity) => {
                    const active = amenityIds.includes(amenity.id);
                    return (
                      <button
                        key={amenity.id}
                        className={[
                          "rounded-[1rem] border px-3 py-3 text-left font-secondary text-sm transition-colors",
                          active
                            ? "border-black/10 bg-[#19150f] text-white"
                            : "border-black/8 bg-[#fbf8f4] text-[#2c251e]",
                        ].join(" ")}
                        onClick={(event) => {
                          event.preventDefault();
                          toggleAmenity(amenity.id);
                        }}
                        type="button"
                      >
                        {amenity.name}
                      </button>
                    );
                  })}
                </div>
              </div>

              <label className="block">
                <span className="mb-2 block font-primary text-[0.62rem] uppercase tracking-[0.2em] text-[#8a7760]">
                  Dodatkowe atrybuty JSON
                </span>
                <textarea
                  className="min-h-32 w-full rounded-[1rem] border border-black/10 bg-[#fbf8f4] px-4 py-3 font-mono text-xs outline-none focus:border-[#19150f]"
                  onChange={(event) => setExtraAttributes(event.target.value)}
                  placeholder='{"stan": "do wejscia", "balkon": true}'
                  value={extraAttributes}
                />
              </label>
            </div>
          )}

          {step === 3 && (
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="mb-2 block font-primary text-[0.62rem] uppercase tracking-[0.2em] text-[#8a7760]">
                  Cena sprzedaży
                </span>
                <input
                  className="h-12 w-full rounded-[1rem] border border-black/10 bg-[#fbf8f4] px-4 font-secondary text-sm outline-none focus:border-[#19150f]"
                  onChange={(event) => setListingPrice(event.target.value)}
                  placeholder="np. 780000"
                  type="number"
                  value={listingPrice}
                />
              </label>
              <label className="block">
                <span className="mb-2 block font-primary text-[0.62rem] uppercase tracking-[0.2em] text-[#8a7760]">
                  Wygasa
                </span>
                <input
                  className="h-12 w-full rounded-[1rem] border border-black/10 bg-[#fbf8f4] px-4 font-secondary text-sm outline-none focus:border-[#19150f]"
                  onChange={(event) => setExpiresAt(event.target.value)}
                  type="datetime-local"
                  value={expiresAt}
                />
              </label>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-6">
              <label className="block">
                <span className="mb-2 block font-primary text-[0.62rem] uppercase tracking-[0.2em] text-[#8a7760]">
                  URL-e zdjęć
                </span>
                <textarea
                  className="min-h-36 w-full rounded-[1rem] border border-black/10 bg-[#fbf8f4] px-4 py-3 font-secondary text-sm outline-none focus:border-[#19150f]"
                  onChange={(event) => setMediaUrls(event.target.value)}
                  placeholder={
                    "https://example.com/front.jpg\nhttps://example.com/salon.jpg"
                  }
                  value={mediaUrls}
                />
                <p className="mt-2 font-secondary text-xs text-[#6f6254]">
                  Pierwszy adres zostanie zapisany jako zdjęcie główne.
                </p>
              </label>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="block">
                  <span className="mb-2 block font-primary text-[0.62rem] uppercase tracking-[0.2em] text-[#8a7760]">
                    Start open house
                  </span>
                  <input
                    className="h-12 w-full rounded-[1rem] border border-black/10 bg-[#fbf8f4] px-4 font-secondary text-sm outline-none focus:border-[#19150f]"
                    onChange={(event) => setOpenHouseStart(event.target.value)}
                    type="datetime-local"
                    value={openHouseStart}
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block font-primary text-[0.62rem] uppercase tracking-[0.2em] text-[#8a7760]">
                    Koniec open house
                  </span>
                  <input
                    className="h-12 w-full rounded-[1rem] border border-black/10 bg-[#fbf8f4] px-4 font-secondary text-sm outline-none focus:border-[#19150f]"
                    onChange={(event) => setOpenHouseEnd(event.target.value)}
                    type="datetime-local"
                    value={openHouseEnd}
                  />
                </label>
              </div>

              <label className="flex items-center gap-3 rounded-[1rem] border border-black/8 bg-[#fbf8f4] px-4 py-3 font-secondary text-sm text-[#2b241d]">
                <input
                  checked={openHouseRequiresRegistration}
                  className="size-4 rounded border border-black/15"
                  onChange={(event) =>
                    setOpenHouseRequiresRegistration(event.target.checked)
                  }
                  type="checkbox"
                />
                Wymagaj wcześniejszej rejestracji na open house
              </label>

              <label className="block">
                <span className="mb-2 block font-primary text-[0.62rem] uppercase tracking-[0.2em] text-[#8a7760]">
                  Instrukcje dla odwiedzających
                </span>
                <textarea
                  className="min-h-28 w-full rounded-[1rem] border border-black/10 bg-[#fbf8f4] px-4 py-3 font-secondary text-sm outline-none focus:border-[#19150f]"
                  onChange={(event) => setOpenHouseInstructions(event.target.value)}
                  placeholder="Np. zamelduj się w lobby lub zaparkuj przy bocznej bramie."
                  value={openHouseInstructions}
                />
              </label>
            </div>
          )}

          {step === 5 && (
            <div className="space-y-5">
              <div className="rounded-[1.5rem] border border-black/8 bg-[#fbf8f4] px-4 py-4">
                <p className="font-primary text-[0.62rem] uppercase tracking-[0.2em] text-[#8a7760]">
                  Profil
                </p>
                <p className="mt-2 font-secondary text-sm text-[#2b241d]">
                  {profile.email} · {profile.business_role}
                  {profile.phone ? ` · ${profile.phone}` : ""}
                </p>
              </div>

              {property && (
                <div className="rounded-[1.5rem] border border-black/8 bg-[#fbf8f4] px-4 py-4">
                  <p className="font-primary text-[0.62rem] uppercase tracking-[0.2em] text-[#8a7760]">
                    Nieruchomość #{property.id}
                  </p>
                  <p className="mt-2 font-secondary text-sm text-[#2b241d]">
                    {property.category_name} · {property.location.city_name}, {property.location.street}{" "}
                    {property.location.building_number}
                  </p>
                  <p className="mt-1 font-secondary text-sm text-[#6f6254]">
                    {property.area_sqm} m² · {property.rooms} pokoje · rok {property.year_built}
                  </p>
                </div>
              )}

              {listing && (
                <div className="rounded-[1.5rem] border border-black/8 bg-[#fbf8f4] px-4 py-4">
                  <p className="font-primary text-[0.62rem] uppercase tracking-[0.2em] text-[#8a7760]">
                    Oferta #{listing.id}
                  </p>
                  <p className="mt-2 font-secondary text-sm text-[#2b241d]">
                    Status: {listing.status} · Cena: {listing.price.toLocaleString("pl-PL")} PLN
                  </p>
                  <p className="mt-1 font-secondary text-sm text-[#6f6254]">
                    Zdjęcia: {listing.media.length} · Open house: {listing.open_houses.length}
                  </p>
                </div>
              )}
            </div>
          )}

          <div className="flex flex-col gap-3 border-t border-black/8 pt-5 sm:flex-row sm:items-center sm:justify-between">
            <button
              className="inline-flex h-11 items-center justify-center rounded-full border border-black/12 px-5 font-secondary text-sm text-[#1d1711] transition-colors hover:bg-[#f2ebe1] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={step === 1 || isSubmitting}
              onClick={goBack}
              type="button"
            >
              Wstecz
            </button>

            <button
              className="inline-flex h-11 items-center justify-center rounded-full bg-[#19150f] px-5 font-secondary text-sm font-medium text-white transition-transform duration-200 hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isSubmitting}
              type="submit"
            >
              {isSubmitting
                ? "Zapisywanie..."
                : step === 5
                  ? "Opublikuj ofertę"
                  : "Zapisz i przejdź dalej"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
