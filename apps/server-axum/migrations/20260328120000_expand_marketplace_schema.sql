CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS billing_accounts (
    id BIGSERIAL PRIMARY KEY,
    account_type TEXT NOT NULL CHECK (account_type IN ('agency', 'private')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS subscription_plans (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    listing_limit INT NOT NULL CHECK (listing_limit >= 0),
    monthly_price NUMERIC(12, 2) NOT NULL CHECK (monthly_price >= 0)
);

CREATE TABLE IF NOT EXISTS subscriptions (
    id BIGSERIAL PRIMARY KEY,
    account_id BIGINT NOT NULL REFERENCES billing_accounts(id) ON DELETE CASCADE,
    plan_id BIGINT NOT NULL REFERENCES subscription_plans(id) ON DELETE RESTRICT,
    start_date TIMESTAMPTZ NOT NULL,
    end_date TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active', 'expired', 'cancelled')),
    payment_status TEXT NOT NULL CHECK (payment_status IN ('paid', 'pending'))
);

CREATE TABLE IF NOT EXISTS agencies (
    id BIGSERIAL PRIMARY KEY,
    billing_account_id BIGINT NOT NULL UNIQUE REFERENCES billing_accounts(id) ON DELETE RESTRICT,
    company_name TEXT NOT NULL,
    nip TEXT NOT NULL,
    address TEXT NOT NULL,
    is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS phone TEXT NULL,
    ADD COLUMN IF NOT EXISTS business_role TEXT NOT NULL DEFAULT 'buyer',
    ADD COLUMN IF NOT EXISTS agency_id BIGINT NULL,
    ADD COLUMN IF NOT EXISTS billing_account_id BIGINT NULL,
    ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DO $$
BEGIN
    ALTER TABLE users
        ADD CONSTRAINT users_business_role_check
        CHECK (business_role IN ('buyer', 'agent', 'developer', 'owner'));
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE users
        ADD CONSTRAINT users_agency_id_fkey
        FOREIGN KEY (agency_id) REFERENCES agencies(id) ON DELETE SET NULL;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE users
        ADD CONSTRAINT users_billing_account_id_fkey
        FOREIGN KEY (billing_account_id) REFERENCES billing_accounts(id) ON DELETE SET NULL;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS users_agency_id_idx ON users (agency_id);
CREATE INDEX IF NOT EXISTS users_billing_account_id_idx ON users (billing_account_id);

CREATE TABLE IF NOT EXISTS voivodeships (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS cities (
    id BIGSERIAL PRIMARY KEY,
    voivodeship_id BIGINT NOT NULL REFERENCES voivodeships(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    UNIQUE (voivodeship_id, name)
);

CREATE TABLE IF NOT EXISTS districts (
    id BIGSERIAL PRIMARY KEY,
    city_id BIGINT NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    UNIQUE (city_id, name)
);

CREATE TABLE IF NOT EXISTS locations (
    id BIGSERIAL PRIMARY KEY,
    city_id BIGINT NOT NULL REFERENCES cities(id) ON DELETE RESTRICT,
    district_id BIGINT NULL REFERENCES districts(id) ON DELETE SET NULL,
    street TEXT NOT NULL,
    postal_code TEXT NOT NULL,
    building_number TEXT NOT NULL,
    apartment_number TEXT NULL,
    coordinates GEOGRAPHY(Point, 4326) NOT NULL
);

CREATE INDEX IF NOT EXISTS locations_city_id_idx ON locations (city_id);
CREATE INDEX IF NOT EXISTS locations_district_id_idx ON locations (district_id);
CREATE INDEX IF NOT EXISTS locations_coordinates_idx ON locations USING GIST (coordinates);

CREATE TABLE IF NOT EXISTS neighborhood_data (
    id BIGSERIAL PRIMARY KEY,
    location_id BIGINT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    category TEXT NOT NULL,
    name TEXT NOT NULL,
    score DOUBLE PRECISION NOT NULL,
    distance_meters INT NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS amenities (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    icon_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS properties (
    id BIGSERIAL PRIMARY KEY,
    location_id BIGINT NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
    category_id BIGINT NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
    area_sqm DOUBLE PRECISION NOT NULL CHECK (area_sqm > 0),
    plot_area_sqm DOUBLE PRECISION NULL CHECK (plot_area_sqm IS NULL OR plot_area_sqm >= 0),
    rooms INT NOT NULL CHECK (rooms >= 0),
    floor INT NOT NULL,
    year_built INT NOT NULL,
    heating_type TEXT NOT NULL,
    extra_attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS property_owners (
    property_id BIGINT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ownership_share NUMERIC(5, 2) NULL,
    PRIMARY KEY (property_id, user_id)
);

CREATE TABLE IF NOT EXISTS property_amenities (
    property_id BIGINT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    amenity_id BIGINT NOT NULL REFERENCES amenities(id) ON DELETE CASCADE,
    PRIMARY KEY (property_id, amenity_id)
);

CREATE TABLE IF NOT EXISTS property_histories (
    id BIGSERIAL PRIMARY KEY,
    property_id BIGINT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL CHECK (event_type IN ('Listed', 'Sold', 'PriceChange')),
    event_date DATE NOT NULL,
    amount NUMERIC(12, 2) NULL,
    price_per_sqm NUMERIC(12, 2) NULL,
    description TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS listings (
    id BIGSERIAL PRIMARY KEY,
    property_id BIGINT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    seller_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    transaction_type TEXT NOT NULL CHECK (transaction_type IN ('sale', 'rent')),
    price NUMERIC(12, 2) NOT NULL CHECK (price >= 0),
    slug TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL CHECK (status IN ('active', 'draft', 'sold', 'expired')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS listings_property_id_idx ON listings (property_id);
CREATE INDEX IF NOT EXISTS listings_seller_user_id_idx ON listings (seller_user_id);
CREATE INDEX IF NOT EXISTS listings_status_idx ON listings (status);

CREATE TABLE IF NOT EXISTS media (
    id BIGSERIAL PRIMARY KEY,
    property_id BIGINT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    listing_id BIGINT NULL REFERENCES listings(id) ON DELETE CASCADE,
    media_type TEXT NOT NULL CHECK (media_type IN ('photo', 'video', '3d_tour')),
    url TEXT NOT NULL,
    is_main BOOLEAN NOT NULL DEFAULT FALSE,
    sort_order INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS open_houses (
    id BIGSERIAL PRIMARY KEY,
    listing_id BIGINT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    requires_registration BOOLEAN NOT NULL DEFAULT FALSE,
    instructions TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS promotions (
    id BIGSERIAL PRIMARY KEY,
    listing_id BIGINT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('highlight', 'top', 'homepage')),
    start_date TIMESTAMPTZ NOT NULL,
    end_date TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS wishlists (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    is_shared BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wishlist_items (
    id BIGSERIAL PRIMARY KEY,
    wishlist_id BIGINT NOT NULL REFERENCES wishlists(id) ON DELETE CASCADE,
    listing_id BIGINT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    user_notes TEXT NOT NULL DEFAULT '',
    UNIQUE (wishlist_id, listing_id)
);

CREATE TABLE IF NOT EXISTS saved_searches (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    criteria JSONB NOT NULL DEFAULT '{}'::jsonb,
    notification_frequency TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS leads (
    id BIGSERIAL PRIMARY KEY,
    buyer_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    listing_id BIGINT NULL REFERENCES listings(id) ON DELETE SET NULL,
    agency_id BIGINT NULL REFERENCES agencies(id) ON DELETE SET NULL,
    seller_user_id BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
    saved_search_id BIGINT NULL REFERENCES saved_searches(id) ON DELETE SET NULL,
    source TEXT NOT NULL CHECK (source IN ('wishlist', 'message', 'saved_search')),
    match_score INT NOT NULL DEFAULT 0,
    status TEXT NOT NULL CHECK (status IN ('new', 'contacted', 'closed')),
    generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS leads_message_unique_idx
    ON leads (buyer_user_id, listing_id, seller_user_id)
    WHERE source = 'message' AND listing_id IS NOT NULL AND seller_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS phone_reveal_logs (
    id BIGSERIAL PRIMARY KEY,
    listing_id BIGINT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    user_id BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
    guest_session_id TEXT NULL,
    revealed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conversations (
    id BIGSERIAL PRIMARY KEY,
    listing_id BIGINT NULL REFERENCES listings(id) ON DELETE SET NULL,
    participant_one_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    participant_two_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (participant_one_id <> participant_two_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS conversations_unique_pair_idx
    ON conversations (
        COALESCE(listing_id, 0),
        LEAST(participant_one_id, participant_two_id),
        GREATEST(participant_one_id, participant_two_id)
    );

CREATE TABLE IF NOT EXISTS messages (
    id BIGSERIAL PRIMARY KEY,
    conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS messages_conversation_id_sent_at_idx
    ON messages (conversation_id, sent_at);
