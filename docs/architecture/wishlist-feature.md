# Wishlist Feature

Ten dokument opisuje feature `wishlist` w sposób zoptymalizowany pod przyszłą pracę LLM i agentów AI. Celem jest szybkie zrozumienie granic feature’a, źródeł prawdy i miejsc integracji bez przeszukiwania całego repo.

## Cel feature’a

Wishlist pozwala:

- zapisywać oferty nieruchomości do ulubionych
- utrzymywać wiele wishlist dla zalogowanego użytkownika
- utrzymywać jedną lokalną wishlistę gościa o nazwie `niezalogowany`
- importować wishlistę gościa po logowaniu
- pokazywać stan zapisania oferty na liście wyników, w popupie mapy i na stronie `/wishlist`

## Zasada architektoniczna

Wishlist jest **feature slice**.

To oznacza:

- logika domenowa wishlisty powinna mieszkać w modułach `wishlist`, a nie w losowych helperach platformy
- pliki spoza slice’a powinny być tylko adapterami/integracjami
- jeśli dodajesz nowe zachowanie wishlisty, najpierw sprawdź czy powinno trafić do slice’a, a nie do `listing-map`, `auth-form`, `index.astro` albo innych ogólnych plików

## Backend slice

Główne źródło prawdy backendu:

- [wishlist.rs](./apps/server-axum/src/wishlist.rs)

Router jedynie deleguje:

- [app.rs](./apps/server-axum/src/app.rs)

Moduł eksportowany przez:

- [lib.rs](./apps/server-axum/src/lib.rs)

Wishlist **nie** powinna wracać do:

- [engagement.rs](./apps/server-axum/src/engagement.rs)

`engagement.rs` obsługuje conversations/messages i jest osobnym feature’em.

### Zakres odpowiedzialności backendu wishlist

Backendowy slice wishlist odpowiada za:

- typy request/response wishlist
- CRUD wishlist
- CRUD wishlist items
- import guest wishlist
- walidację zastrzeżonej nazwy `niezalogowany`
- walidację koloru wishlisty
- wzbogacanie itemów wishlisty o minimalny snapshot oferty

### Publiczne endpointy wishlist

Wszystkie są pod `/api/v1`:

- `GET /wishlists`
- `POST /wishlists`
- `GET /wishlists/:id`
- `PATCH /wishlists/:id`
- `DELETE /wishlists/:id`
- `POST /wishlists/:id/items`
- `DELETE /wishlists/:id/items/:item_id`
- `POST /wishlists/import-guest`

### Dane trwałe

Tabela:

- `wishlists`
- `wishlist_items`

Kolor wishlisty pochodzi z migracji:

- [20260408120000_extend_wishlists_for_guest_and_colors.sql](./apps/server-axum/migrations/20260408120000_extend_wishlists_for_guest_and_colors.sql)

Snapshot aktualnego schematu:

- [schema.md](./apps/server-axum/schema.md)

### Reguły domenowe backendu

- Każdy zalogowany użytkownik może używać wishlist.
- Standardowe create/update nie mogą używać nazwy `niezalogowany`.
- `import-guest` jest jedynym miejscem, które może tworzyć listę o nazwie `niezalogowany`.
- Import deduplikuje `listing_id`.
- `WishlistResponse` zwraca pełne `items`, a każdy item zawiera `listing` snapshot potrzebny UI.

## Frontend slice

Główne źródło prawdy frontendu:

- [features/wishlist/index.ts](./apps/front/src/features/wishlist/index.ts)

Pliki slice’a:

- [model.ts](./apps/front/src/features/wishlist/model.ts)
- [storage.ts](./apps/front/src/features/wishlist/storage.ts)
- [api.ts](./apps/front/src/features/wishlist/api.ts)
- [events.ts](./apps/front/src/features/wishlist/events.ts)
- [auth-merge.ts](./apps/front/src/features/wishlist/auth-merge.ts)
- [map-view.ts](./apps/front/src/features/wishlist/map-view.ts)
- [WishlistPage.tsx](./apps/front/src/features/wishlist/WishlistPage.tsx)
- [server.ts](./apps/front/src/features/wishlist/server.ts)

### Odpowiedzialności frontendu

`model.ts`

- typy domenowe wishlist
- paleta kolorów
- transformacje czysto domenowe

`storage.ts`

- lokalna wishlista gościa
- odczyt/zapis `localStorage`
- brak zależności od React/Astro

`api.ts`

- wywołania HTTP do backendu wishlist
- brak zależności od konkretnych komponentów

`events.ts`

- prosty event bus feature’a (`wishlist:changed`)
- synchronizacja między adapterami i UI

`auth-merge.ts`

- import wishlisty gościa po logowaniu/rejestracji

`map-view.ts`

- adapter widoku mapy pod wishlistę
- kolorowanie markerów i przycisków
- transformacje dla badge’y cenowych i popupów

`WishlistPage.tsx`

- główny UI `/wishlist`

### Cienkie adaptery kompatybilności

Poniższe pliki **nie są** źródłem prawdy. One tylko re-exportują lub integrują slice:

- [wishlist-client.ts](./apps/front/src/lib/wishlist-client.ts)
- [wishlist-types.ts](./apps/front/src/lib/wishlist-types.ts)
- [wishlist.ts](./apps/front/src/lib/server/wishlist.ts)
- [components/wishlist/WishlistPage.tsx](./apps/front/src/components/wishlist/WishlistPage.tsx)

Jeśli zmieniasz domenę wishlisty, zmieniaj najpierw `features/wishlist/*`, nie adaptery.

## Miejsca integracji z resztą systemu

### Logowanie / rejestracja

Integracja:

- [auth-form.ts](./apps/front/src/scripts/auth-form.ts)

Rola adaptera:

- po udanym auth wywołuje `auth-merge.ts`
- nie powinien zawierać logiki domenowej wishlisty

### Widok mapy i listingów

Integracja:

- [listing-map.ts](./apps/front/src/scripts/listing-map.ts)
- [ListingMap.astro](./apps/front/src/components/map/ListingMap.astro)
- [listing.astro](./apps/front/src/pages/listing.astro)

Rola adaptera:

- podpięcie heart buttons i dialogu do slice’a
- renderowanie price badges na mapie
- popup oferty i stan zapisania

Zasada:

- jeśli logika jest specyficzna dla wishlisty, preferuj `features/wishlist/map-view.ts`
- `listing-map.ts` powinien zostać adapterem MapLibre, nie drugim źródłem prawdy feature’a

### Strona wishlist

Entry point:

- [wishlist.astro](./apps/front/src/pages/wishlist.astro)

SSR adapter:

- [server.ts](./apps/front/src/features/wishlist/server.ts)

UI:

- [WishlistPage.tsx](./apps/front/src/features/wishlist/WishlistPage.tsx)

## Przepływy danych

### 1. Gość dodaje ofertę do wishlisty

1. Heart na karcie/popupie/mapie trafia do adaptera mapy.
2. Adapter używa `storage.ts`.
3. Aktualizacja zapisuje `guest_wishlist_v1` w `localStorage`.
4. `events.ts` emituje `wishlist:changed`.
5. UI odświeża badge/serduszka i stronę `/wishlist`.

### 2. Zalogowany użytkownik zapisuje ofertę

1. Adapter mapy otwiera picker wishlist.
2. Picker używa `api.ts` do `POST /wishlists/:id/items` lub `DELETE /wishlists/:id/items/:item_id`.
3. Po sukcesie frontend odświeża listy przez `fetchWishlists`.
4. `events.ts` rozgłasza nowy stan zapisanych ofert.

### 3. Import wishlisty gościa po logowaniu

1. Auth adapter wywołuje `auth-merge.ts`.
2. `auth-merge.ts` czyta `localStorage`.
3. Jeśli guest wishlist zawiera oferty, wywołuje `POST /wishlists/import-guest`.
4. Po sukcesie czyści guest storage.
5. Emituje `wishlist:changed`.

## Zasady modyfikacji dla LLM

### Jeśli chcesz zmienić model wishlisty

Najpierw zmień:

- backend: [wishlist.rs](./apps/server-axum/src/wishlist.rs)
- frontend: [model.ts](./apps/front/src/features/wishlist/model.ts)

Potem dopiero:

- `api.ts`
- `storage.ts`
- `map-view.ts`
- `WishlistPage.tsx`

### Jeśli chcesz zmienić UX mapy wishlist

Najpierw sprawdź:

- [map-view.ts](./apps/front/src/features/wishlist/map-view.ts)

Nie zaczynaj od:

- [listing-map.ts](./apps/front/src/scripts/listing-map.ts)

chyba że zmiana dotyczy czysto infrastruktury MapLibre.

### Jeśli chcesz zmienić merge po auth

Zmieniaj:

- [auth-merge.ts](./apps/front/src/features/wishlist/auth-merge.ts)

Nie wkładaj nowej logiki do:

- [auth-form.ts](./apps/front/src/scripts/auth-form.ts)

### Jeśli chcesz zmienić guest storage

Zmieniaj:

- [storage.ts](./apps/front/src/features/wishlist/storage.ts)
- [model.ts](./apps/front/src/features/wishlist/model.ts)

Nie rozrzucaj logiki `localStorage` po komponentach.

## Inwarianty

- Guest wishlist zawsze ma nazwę `niezalogowany`.
- Zalogowany użytkownik nie może ręcznie stworzyć wishlisty o nazwie `niezalogowany`.
- Kolor wishlisty musi być jednym z tokenów palety, nie dowolnym hexem.
- UI mapy, popup i `/wishlist` powinny korzystać z tego samego modelu kolorów i saved state.
- Adaptery mogą importować slice, ale slice nie powinien zależeć od adapterów.

## Szybki checklist dla zmian

- Czy zmiana trafiła do `features/wishlist/*` albo `src/wishlist.rs` zamiast do losowego helpera?
- Czy adaptery są nadal cienkie?
- Czy backendowy shape i frontendowy model nadal się zgadzają?
- Czy guest flow i logged-in flow nadal mają osobne źródła danych?
- Czy po zmianie uruchomiono:
  - `pnpm --filter server-axum test`
  - `pnpm --filter front check-types`
  - `pnpm --filter front build`
