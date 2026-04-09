import { getServerApiBaseUrl } from "../auth";

export type ProfileResponse = {
  id: number;
  email: string;
  role: "admin" | "user";
  business_role: "buyer" | "agent" | "developer" | "owner";
  phone: string | null;
  agency_id: number | null;
  billing_account_id: number | null;
  is_verified: boolean;
};

export type SellerDashboardSummary = {
  draftCount: number;
  activeCount: number;
  soldCount: number;
  expiredCount: number;
  conversationCount: number;
  upcomingOpenHouseCount: number;
};

export type SellerChecklistItem = {
  id: string;
  label: string;
  description: string;
  complete: boolean;
};

export type PropertyLocation = {
  id: number;
  city_id: number;
  city_name: string;
  district_id: number | null;
  district_name: string | null;
  street: string;
  postal_code: string;
  building_number: string;
  apartment_number: string | null;
  latitude: number;
  longitude: number;
};

export type PropertyOwner = {
  user_id: number;
  ownership_share: number | null;
};

export type PropertyResponse = {
  id: number;
  location: PropertyLocation;
  category_id: number;
  category_name: string;
  area_sqm: number;
  plot_area_sqm: number | null;
  rooms: number;
  floor: number;
  year_built: number;
  heating_type: string;
  extra_attributes: Record<string, unknown>;
  amenity_ids: number[];
  owners: PropertyOwner[];
  created_at: string;
  updated_at: string;
};

export type MediaResponse = {
  id: number;
  property_id: number;
  listing_id: number | null;
  media_type: "photo" | "video" | "3d_tour";
  url: string;
  is_main: boolean;
  sort_order: number;
};

export type OpenHouseResponse = {
  id: number;
  listing_id: number;
  start_time: string;
  end_time: string;
  requires_registration: boolean;
  instructions: string;
};

export type ListingResponse = {
  id: number;
  property_id: number;
  seller_user_id: number;
  transaction_type: "sale" | "rent";
  price: number;
  slug: string;
  status: "draft" | "active" | "sold" | "expired";
  created_at: string;
  updated_at: string;
  expires_at: string;
  property: PropertyResponse;
  media: MediaResponse[];
  open_houses: OpenHouseResponse[];
};

export type SellerConversationSummary = {
  id: number;
  listing_id: number | null;
  participant_user_id: number;
  participant_user_email: string;
  last_message_preview: string;
  last_message_at: string | null;
  updated_at: string;
};

export type SellerOpenHouseSummary = {
  id: number;
  listing_id: number;
  listing_slug: string;
  start_time: string;
  end_time: string;
  requires_registration: boolean;
  instructions: string;
  city: string;
  street: string;
};

export type SellerDashboardResponse = {
  profile: ProfileResponse;
  summary: SellerDashboardSummary;
  checklist: SellerChecklistItem[];
  recentListings: ListingResponse[];
  recentConversations: SellerConversationSummary[];
  upcomingOpenHouses: SellerOpenHouseSummary[];
};

export type PaginatedResponse<T> = {
  items: T[];
  page: number;
  per_page: number;
  total: number;
};

export type DictionaryItem = {
  id: number;
  name: string;
};

export type AmenityResponse = {
  id: number;
  name: string;
  icon_name: string;
};

type ServerJsonRequest = RequestInit & {
  body?: BodyInit | null;
};

class ApiRequestError extends Error {
  status: number;

  constructor(path: string, status: number, message: string) {
    super(`API request failed for ${path}: ${status} ${message}`);
    this.status = status;
  }
}

async function fetchServerJson<T>(
  request: Request,
  locals: App.Locals | undefined,
  path: string,
  init: ServerJsonRequest = {},
): Promise<T> {
  const cookieHeader = request.headers.get("cookie");
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  if (cookieHeader) {
    headers.set("cookie", cookieHeader);
  }

  const response = await fetch(`${getServerApiBaseUrl(locals)}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    const message = await response.text();
    throw new ApiRequestError(path, response.status, message);
  }

  return (await response.json()) as T;
}

export function fetchDashboardData(
  request: Request,
  locals?: App.Locals,
): Promise<SellerDashboardResponse> {
  return fetchDashboardDataWithFallback(request, locals);
}

export async function fetchMyListings(
  request: Request,
  locals: App.Locals | undefined,
  status?: string | null,
): Promise<PaginatedResponse<ListingResponse>> {
  const params = new URLSearchParams();
  if (status) {
    params.set("status", status);
  }
  const suffix = params.toString() ? `?${params.toString()}` : "";
  try {
    return await fetchServerJson<PaginatedResponse<ListingResponse>>(
      request,
      locals,
      `/api/v1/me/listings${suffix}`,
    );
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) {
      return {
        items: [],
        page: 1,
        per_page: 20,
        total: 0,
      };
    }

    throw error;
  }
}

export function fetchProfile(
  request: Request,
  locals?: App.Locals,
): Promise<ProfileResponse> {
  return fetchServerJson<ProfileResponse>(request, locals, "/api/v1/profile");
}

export function fetchVoivodeships(
  request: Request,
  locals?: App.Locals,
): Promise<PaginatedResponse<DictionaryItem>> {
  return fetchServerJson<PaginatedResponse<DictionaryItem>>(
    request,
    locals,
    "/api/v1/dictionaries/voivodeships?per_page=100",
  );
}

export function fetchCategories(
  request: Request,
  locals?: App.Locals,
): Promise<PaginatedResponse<DictionaryItem>> {
  return fetchServerJson<PaginatedResponse<DictionaryItem>>(
    request,
    locals,
    "/api/v1/categories?per_page=100",
  );
}

export function fetchAmenities(
  request: Request,
  locals?: App.Locals,
): Promise<PaginatedResponse<AmenityResponse>> {
  return fetchServerJson<PaginatedResponse<AmenityResponse>>(
    request,
    locals,
    "/api/v1/amenities?per_page=100",
  );
}

async function fetchDashboardDataWithFallback(
  request: Request,
  locals?: App.Locals,
): Promise<SellerDashboardResponse> {
  try {
    return await fetchServerJson<SellerDashboardResponse>(
      request,
      locals,
      "/api/v1/me/seller-dashboard",
    );
  } catch (error) {
    if (!(error instanceof ApiRequestError) || error.status !== 404) {
      throw error;
    }

    const profile = await fetchProfile(request, locals);
    return buildFallbackDashboard(profile);
  }
}

function buildFallbackDashboard(profile: ProfileResponse): SellerDashboardResponse {
  const isSeller =
    profile.business_role === "owner" ||
    profile.business_role === "agent" ||
    profile.business_role === "developer";

  return {
    profile,
    summary: {
      draftCount: 0,
      activeCount: 0,
      soldCount: 0,
      expiredCount: 0,
      conversationCount: 0,
      upcomingOpenHouseCount: 0,
    },
    checklist: [
      {
        id: "seller-role",
        label: "Profil wystawiającego",
        description: isSeller
          ? `Konto działa jako ${businessRoleLabel(profile.business_role)}.`
          : "Wybierz rolę właściciela lub agenta, aby przejść do sprzedaży.",
        complete: isSeller,
      },
      {
        id: "contact-phone",
        label: "Telefon kontaktowy",
        description: profile.phone
          ? `Telefon zapisany: ${profile.phone}.`
          : "Dodaj numer telefonu, aby kupujący mogli szybciej się z Tobą skontaktować.",
        complete: Boolean(profile.phone),
      },
      {
        id: "agency",
        label: "Agencja",
        description:
          profile.business_role !== "agent"
            ? "Agencja nie jest wymagana dla tego typu konta."
            : profile.agency_id
              ? "Konto ma już przypisaną agencję."
              : "Agent musi mieć przypisaną agencję przed publikacją oferty.",
        complete:
          profile.business_role !== "agent" || profile.agency_id !== null,
      },
      {
        id: "draft-listing",
        label: "Szkic oferty",
        description:
          "Po restarcie backendu pojawią się tu Twoje szkice i ostatnie oferty.",
        complete: false,
      },
      {
        id: "main-photo",
        label: "Główne zdjęcie",
        description:
          "Dodaj zdjęcie główne w kreatorze oferty, aby przygotować publikację.",
        complete: false,
      },
      {
        id: "publication",
        label: "Publikacja",
        description:
          "Aktywne oferty pojawią się tutaj po uruchomieniu nowej wersji backendu.",
        complete: false,
      },
    ],
    recentListings: [],
    recentConversations: [],
    upcomingOpenHouses: [],
  };
}

function businessRoleLabel(role: ProfileResponse["business_role"]) {
  switch (role) {
    case "agent":
      return "agent";
    case "developer":
      return "deweloper";
    case "owner":
      return "właściciel";
    default:
      return "kupujący";
  }
}
