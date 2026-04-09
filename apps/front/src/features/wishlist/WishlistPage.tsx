import { useEffect, useMemo, useState } from "react";

import type { SessionUser } from "../../lib/auth";
import {
  createWishlist,
  deleteWishlist,
  emitWishlistChanged,
  fetchWishlists,
  guestWishlistToWishlist,
  removeGuestWishlistListing,
  removeWishlistItem,
  subscribeWishlistChanged,
  updateWishlist,
} from "./index";
import {
  GUEST_WISHLIST_STORAGE_KEY,
  WISHLIST_COLOR_META,
  WISHLIST_COLOR_OPTIONS,
  type Wishlist,
  type WishlistColor,
} from "./model";
import { readGuestWishlist } from "./storage";

type WishlistPageProps = {
  apiBaseUrl: string;
  initialUser: SessionUser | null;
  initialWishlists: Wishlist[];
};

export function WishlistPage({
  apiBaseUrl,
  initialUser,
  initialWishlists,
}: WishlistPageProps) {
  const [user] = useState(initialUser);
  const [wishlists, setWishlists] = useState<Wishlist[]>(initialWishlists);
  const [selectedWishlistId, setSelectedWishlistId] = useState<number | null>(
    initialWishlists[0]?.id ?? null,
  );
  const [isBusy, setIsBusy] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [pendingItemId, setPendingItemId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newWishlistName, setNewWishlistName] = useState("");
  const [newWishlistColor, setNewWishlistColor] =
    useState<WishlistColor>("sand");
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState<WishlistColor>("sand");

  useEffect(() => {
    if (user) {
      setWishlists(initialWishlists);
      setSelectedWishlistId((current) => current ?? initialWishlists[0]?.id ?? null);
      return;
    }

    const guestWishlist = guestWishlistToWishlist(
      readGuestWishlist(GUEST_WISHLIST_STORAGE_KEY),
    );
    setWishlists([guestWishlist]);
    setSelectedWishlistId(guestWishlist.id);
  }, [initialWishlists, user]);

  useEffect(() => {
    const selected =
      wishlists.find((wishlist) => wishlist.id === selectedWishlistId) ??
      wishlists[0] ??
      null;
    setEditName(selected?.name ?? "");
    setEditColor(selected?.color ?? "sand");
    if (!selected && wishlists.length > 0) {
      setSelectedWishlistId(wishlists[0].id);
    }
  }, [selectedWishlistId, wishlists]);

  useEffect(() => {
    return subscribeWishlistChanged((detail) => {
      if (detail.mode === "guest" && !user && detail.guestWishlist) {
        setWishlists([guestWishlistToWishlist(detail.guestWishlist)]);
        setSelectedWishlistId(-1);
      }

      if (detail.mode === "user" && user) {
        setWishlists(detail.wishlists);
      }
    });
  }, [user]);

  const selectedWishlist = useMemo(
    () =>
      wishlists.find((wishlist) => wishlist.id === selectedWishlistId) ??
      wishlists[0] ??
      null,
    [selectedWishlistId, wishlists],
  );

  async function reloadServerWishlists() {
    if (!user) {
      return;
    }

    const nextWishlists = await fetchWishlists(apiBaseUrl);
    setWishlists(nextWishlists);
    emitWishlistChanged({
      mode: "user",
      savedListingIds: nextWishlists.flatMap((wishlist) =>
        wishlist.items.map((item) => item.listing_id),
      ),
      wishlists: nextWishlists,
      guestWishlist: null,
    });
    if (nextWishlists.length > 0) {
      setSelectedWishlistId((current) => current ?? nextWishlists[0].id);
    }
  }

  async function handleCreateWishlist() {
    if (!user || !newWishlistName.trim()) {
      return;
    }

    setIsBusy(true);
    setPendingAction("Tworzenie wishlisty...");
    setError(null);
    setNotice(null);

    try {
      const created = await createWishlist(apiBaseUrl, {
        name: newWishlistName,
        color: newWishlistColor,
        is_shared: false,
      });
      const nextWishlists = [created, ...wishlists];
      setWishlists(nextWishlists);
      setSelectedWishlistId(created.id);
      setNewWishlistName("");
      setNewWishlistColor("sand");
      setNotice("Nowa wishlista została utworzona.");
      await reloadServerWishlists();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Nie udało się utworzyć wishlisty.");
    } finally {
      setIsBusy(false);
      setPendingAction(null);
    }
  }

  async function handleSaveWishlist() {
    if (!user || !selectedWishlist) {
      return;
    }

    setIsBusy(true);
    setPendingAction("Zapisywanie zmian...");
    setError(null);
    setNotice(null);

    try {
      const updated = await updateWishlist(apiBaseUrl, selectedWishlist.id, {
        name: editName,
        color: editColor,
      });
      const nextWishlists = wishlists.map((wishlist) =>
        wishlist.id === updated.id ? updated : wishlist,
      );
      setWishlists(nextWishlists);
      setNotice("Wishlista została zaktualizowana.");
      await reloadServerWishlists();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Nie udało się zapisać zmian.");
    } finally {
      setIsBusy(false);
      setPendingAction(null);
    }
  }

  async function handleDeleteWishlist() {
    if (!user || !selectedWishlist) {
      return;
    }

    setIsBusy(true);
    setPendingAction("Usuwanie wishlisty...");
    setError(null);
    setNotice(null);

    try {
      await deleteWishlist(apiBaseUrl, selectedWishlist.id);
      const nextWishlists = wishlists.filter(
        (wishlist) => wishlist.id !== selectedWishlist.id,
      );
      setWishlists(nextWishlists);
      setSelectedWishlistId(nextWishlists[0]?.id ?? null);
      setNotice("Wishlista została usunięta.");
      await reloadServerWishlists();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Nie udało się usunąć wishlisty.");
    } finally {
      setIsBusy(false);
      setPendingAction(null);
    }
  }

  async function handleRemoveItem(itemId: number, listingId: number) {
    if (!selectedWishlist) {
      return;
    }

    setIsBusy(true);
    setPendingAction("Usuwanie oferty...");
    setPendingItemId(itemId);
    setError(null);
    setNotice(null);

    try {
      if (user) {
        await removeWishlistItem(apiBaseUrl, selectedWishlist.id, itemId);
        await reloadServerWishlists();
      } else {
        removeGuestWishlistListing(GUEST_WISHLIST_STORAGE_KEY, listingId);
        setWishlists([
          guestWishlistToWishlist(readGuestWishlist(GUEST_WISHLIST_STORAGE_KEY)),
        ]);
      }

      setNotice("Oferta została usunięta z wishlisty.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Nie udało się usunąć oferty.");
    } finally {
      setIsBusy(false);
      setPendingAction(null);
      setPendingItemId(null);
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[19rem_minmax(0,1fr)]">
      <aside className="rounded-[2rem] border border-black/8 bg-white/86 p-5 shadow-[0_18px_40px_rgba(42,33,23,0.06)]">
        <p className="font-primary text-[0.64rem] uppercase tracking-[0.24em] text-[#8a7760]">
          Twoje listy
        </p>
        <h2 className="mt-2 font-secondary text-xl font-semibold text-[#19150f]">
          Wishlista ofert
        </h2>
        <p className="mt-3 font-secondary text-sm text-[#665a4e]">
          {user
            ? "Twórz wiele list, oznaczaj je kolorem i porządkuj oferty według scenariuszy zakupu."
            : 'Jako gość możesz korzystać z jednej wishlisty "niezalogowany".'}
        </p>

        <div className="mt-5 space-y-2">
          {wishlists.map((wishlist) => {
            const colorMeta = WISHLIST_COLOR_META[wishlist.color];
            const active = selectedWishlist?.id === wishlist.id;
            return (
              <button
                key={wishlist.id}
                className={[
                  "flex w-full items-center justify-between rounded-[1.2rem] border px-3 py-3 text-left transition-colors",
                  active
                    ? "border-black/10 bg-[#19150f] text-white"
                    : "border-black/8 bg-[#fbf8f4] text-[#2c251e]",
                ].join(" ")}
                onClick={() => setSelectedWishlistId(wishlist.id)}
                type="button"
              >
                <span className="flex items-center gap-3">
                  <span
                    className="h-3 w-3 rounded-full border border-black/10"
                    style={{ backgroundColor: colorMeta.accent }}
                  />
                  <span>
                    <span className="block font-secondary text-sm font-semibold">
                      {wishlist.name}
                    </span>
                    <span className="block font-secondary text-xs opacity-75">
                      {wishlist.items.length} ofert
                    </span>
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        {user && (
          <div className="mt-6 rounded-[1.4rem] border border-black/8 bg-[#fbf8f4] p-4">
            <p className="font-primary text-[0.62rem] uppercase tracking-[0.2em] text-[#8a7760]">
              Nowa wishlista
            </p>
            <div className="mt-3 space-y-3">
              <input
                className="h-11 w-full rounded-[1rem] border border-black/10 bg-white px-4 font-secondary text-sm outline-none focus:border-[#19150f]"
                onChange={(event) => setNewWishlistName(event.target.value)}
                placeholder="Np. Mieszkania inwestycyjne"
                value={newWishlistName}
              />
              <div className="flex flex-wrap gap-2">
                {WISHLIST_COLOR_OPTIONS.map((color) => {
                  const meta = WISHLIST_COLOR_META[color];
                  const active = newWishlistColor === color;
                  return (
                    <button
                      key={color}
                      className={[
                        "rounded-full border px-3 py-1.5 font-secondary text-xs transition-colors",
                        active
                          ? "border-black/10 bg-[#19150f] text-white"
                          : "border-black/10 bg-white text-[#2c251e]",
                      ].join(" ")}
                      onClick={() => setNewWishlistColor(color)}
                      type="button"
                    >
                      {meta.label}
                    </button>
                  );
                })}
              </div>
              <button
                className="inline-flex h-11 w-full items-center justify-center rounded-full bg-[#19150f] px-5 font-secondary text-sm font-medium text-white disabled:opacity-60"
                disabled={isBusy || !newWishlistName.trim()}
                onClick={() => void handleCreateWishlist()}
                type="button"
              >
                {isBusy && pendingAction === "Tworzenie wishlisty..."
                  ? "Tworzenie..."
                  : "Utwórz wishlistę"}
              </button>
            </div>
          </div>
        )}
      </aside>

      <section className="rounded-[2rem] border border-black/8 bg-white/86 p-5 shadow-[0_18px_40px_rgba(42,33,23,0.06)]">
        {error && (
          <div className="mb-4 rounded-[1.2rem] border border-[#d0a06a]/40 bg-[#fff4e8] px-4 py-3 font-secondary text-sm text-[#7a4f1c]">
            {error}
          </div>
        )}
        {notice && (
          <div className="mb-4 rounded-[1.2rem] border border-[#cde3d2] bg-[#edf8ef] px-4 py-3 font-secondary text-sm text-[#2f6e45]">
            {notice}
          </div>
        )}
        {isBusy && pendingAction && (
          <div className="mb-4 rounded-[1.2rem] border border-black/8 bg-[#fbf8f4] px-4 py-3 font-secondary text-sm text-[#665a4e]">
            {pendingAction}
          </div>
        )}

        {selectedWishlist ? (
          <>
            <div className="flex flex-col gap-5 border-b border-black/8 pb-5 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="font-primary text-[0.64rem] uppercase tracking-[0.24em] text-[#8a7760]">
                  Aktywna lista
                </p>
                <h2 className="mt-2 font-secondary text-[1.9rem] font-semibold tracking-[-0.04em] text-[#17130f]">
                  {selectedWishlist.name}
                </h2>
                <p className="mt-2 font-secondary text-sm text-[#665a4e]">
                  {selectedWishlist.items.length} zapisanych ofert
                </p>
              </div>

              {user ? (
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto]">
                  <input
                    className="h-11 rounded-[1rem] border border-black/10 bg-[#fbf8f4] px-4 font-secondary text-sm outline-none focus:border-[#19150f]"
                    onChange={(event) => setEditName(event.target.value)}
                    value={editName}
                  />
                  <select
                    className="h-11 rounded-[1rem] border border-black/10 bg-[#fbf8f4] px-4 font-secondary text-sm outline-none focus:border-[#19150f]"
                    onChange={(event) =>
                      setEditColor(event.target.value as WishlistColor)
                    }
                    value={editColor}
                  >
                    {WISHLIST_COLOR_OPTIONS.map((color) => (
                      <option key={color} value={color}>
                        {WISHLIST_COLOR_META[color].label}
                      </option>
                    ))}
                  </select>
                  <div className="flex gap-2">
                    <button
                      className="inline-flex h-11 items-center justify-center rounded-full border border-black/10 px-4 font-secondary text-sm text-[#1d1711]"
                      disabled={isBusy}
                      onClick={() => void handleSaveWishlist()}
                      type="button"
                    >
                      {isBusy && pendingAction === "Zapisywanie zmian..."
                        ? "Zapisywanie..."
                        : "Zapisz"}
                    </button>
                    <button
                      className="inline-flex h-11 items-center justify-center rounded-full bg-[#efe4d8] px-4 font-secondary text-sm text-[#6c4636]"
                      disabled={isBusy}
                      onClick={() => void handleDeleteWishlist()}
                      type="button"
                    >
                      {isBusy && pendingAction === "Usuwanie wishlisty..."
                        ? "Usuwanie..."
                        : "Usuń"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="rounded-[1.1rem] border border-black/8 bg-[#fbf8f4] px-4 py-3 font-secondary text-sm text-[#665a4e]">
                  Zaloguj się, aby mieć wiele wishlist i zapisywać je w koncie.
                </div>
              )}
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {selectedWishlist.items.length === 0 ? (
                <div className="rounded-[1.4rem] border border-dashed border-black/15 bg-[#fbf8f4] px-5 py-8 font-secondary text-sm text-[#665a4e]">
                  Ta wishlista jest pusta. Dodaj oferty przez serduszko na stronie listingów.
                </div>
              ) : (
                selectedWishlist.items.map((item) => (
                  <article
                    key={item.id}
                    className="overflow-hidden rounded-[1.5rem] border border-black/8 bg-[#fbf8f4]"
                  >
                    <div className="aspect-[16/10] bg-[#efe7dc]">
                      <img
                        alt={item.listing.title}
                        className="h-full w-full object-cover"
                        loading="lazy"
                        src={item.listing.thumbnail_url}
                      />
                    </div>
                    <div className="p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="font-primary text-[0.62rem] uppercase tracking-[0.2em] text-[#8a7760]">
                            {item.listing.transaction_type === "rent" ? "Wynajem" : "Kupno"}
                          </p>
                          <h3 className="mt-2 font-secondary text-lg font-semibold text-[#1d1711]">
                            {item.listing.title}
                          </h3>
                        </div>
                        <button
                          aria-label="Usuń ofertę z wishlisty"
                          className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-black/10 bg-white text-[#8a5b5b]"
                          disabled={isBusy}
                          style={{
                            backgroundColor: WISHLIST_COLOR_META[selectedWishlist.color].accent,
                            borderColor: WISHLIST_COLOR_META[selectedWishlist.color].accent,
                            color: "#ffffff",
                          }}
                          onClick={() => void handleRemoveItem(item.id, item.listing_id)}
                          type="button"
                        >
                          {pendingItemId === item.id ? "…" : "♥"}
                        </button>
                      </div>

                      <p className="mt-2 font-secondary text-sm text-[#665a4e]">
                        {item.listing.street}, {item.listing.city}
                      </p>
                      <div className="mt-4 flex items-center justify-between gap-4">
                        <span className="font-secondary text-sm text-[#2b241d]">
                          {new Intl.NumberFormat("pl-PL", {
                            style: "currency",
                            currency: "PLN",
                            maximumFractionDigits: 0,
                          }).format(item.listing.price)}
                        </span>
                        <a
                          className="font-secondary text-sm text-[#1d1711] underline decoration-black/20 underline-offset-4"
                          href="/listing"
                        >
                          Otwórz listę ofert
                        </a>
                      </div>
                    </div>
                  </article>
                ))
              )}
            </div>
          </>
        ) : (
          <div className="rounded-[1.4rem] border border-dashed border-black/15 bg-[#fbf8f4] px-5 py-8 font-secondary text-sm text-[#665a4e]">
            Nie masz jeszcze wishlist. Utwórz pierwszą listę lub dodaj ofertę przez serduszko.
          </div>
        )}
      </section>
    </div>
  );
}
