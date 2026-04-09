
CREATE TABLE IF NOT EXISTS public._sqlx_migrations
(
    version bigint NOT NULL,
    description text COLLATE pg_catalog."default" NOT NULL,
    installed_on timestamp with time zone NOT NULL DEFAULT now(),
    success boolean NOT NULL,
    checksum bytea NOT NULL,
    execution_time bigint NOT NULL,
    CONSTRAINT _sqlx_migrations_pkey PRIMARY KEY (version)
);

CREATE TABLE IF NOT EXISTS public.agencies
(
    id bigserial NOT NULL,
    billing_account_id bigint NOT NULL,
    company_name text COLLATE pg_catalog."default" NOT NULL,
    nip text COLLATE pg_catalog."default" NOT NULL,
    address text COLLATE pg_catalog."default" NOT NULL,
    is_verified boolean NOT NULL DEFAULT false,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT agencies_pkey PRIMARY KEY (id),
    CONSTRAINT agencies_billing_account_id_key UNIQUE (billing_account_id)
);

CREATE TABLE IF NOT EXISTS public.amenities
(
    id bigserial NOT NULL,
    name text COLLATE pg_catalog."default" NOT NULL,
    icon_name text COLLATE pg_catalog."default" NOT NULL,
    CONSTRAINT amenities_pkey PRIMARY KEY (id),
    CONSTRAINT amenities_name_key UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS public.billing_accounts
(
    id bigserial NOT NULL,
    account_type text COLLATE pg_catalog."default" NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT billing_accounts_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.categories
(
    id bigserial NOT NULL,
    name text COLLATE pg_catalog."default" NOT NULL,
    CONSTRAINT categories_pkey PRIMARY KEY (id),
    CONSTRAINT categories_name_key UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS public.cities
(
    id bigserial NOT NULL,
    voivodeship_id bigint NOT NULL,
    name text COLLATE pg_catalog."default" NOT NULL,
    CONSTRAINT cities_pkey PRIMARY KEY (id),
    CONSTRAINT cities_voivodeship_id_name_key UNIQUE (voivodeship_id, name)
);

CREATE TABLE IF NOT EXISTS public.conversations
(
    id bigserial NOT NULL,
    listing_id bigint,
    participant_one_id bigint NOT NULL,
    participant_two_id bigint NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT conversations_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.districts
(
    id bigserial NOT NULL,
    city_id bigint NOT NULL,
    name text COLLATE pg_catalog."default" NOT NULL,
    CONSTRAINT districts_pkey PRIMARY KEY (id),
    CONSTRAINT districts_city_id_name_key UNIQUE (city_id, name)
);

CREATE TABLE IF NOT EXISTS public.leads
(
    id bigserial NOT NULL,
    buyer_user_id bigint NOT NULL,
    listing_id bigint,
    agency_id bigint,
    seller_user_id bigint,
    saved_search_id bigint,
    source text COLLATE pg_catalog."default" NOT NULL,
    match_score integer NOT NULL DEFAULT 0,
    status text COLLATE pg_catalog."default" NOT NULL,
    generated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT leads_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.listings
(
    id bigserial NOT NULL,
    property_id bigint NOT NULL,
    seller_user_id bigint NOT NULL,
    transaction_type text COLLATE pg_catalog."default" NOT NULL,
    price numeric(12, 2) NOT NULL,
    slug text COLLATE pg_catalog."default" NOT NULL,
    status text COLLATE pg_catalog."default" NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    expires_at timestamp with time zone NOT NULL,
    CONSTRAINT listings_pkey PRIMARY KEY (id),
    CONSTRAINT listings_slug_key UNIQUE (slug)
);

CREATE TABLE IF NOT EXISTS public.locations
(
    id bigserial NOT NULL,
    city_id bigint NOT NULL,
    district_id bigint,
    street text COLLATE pg_catalog."default" NOT NULL,
    postal_code text COLLATE pg_catalog."default" NOT NULL,
    building_number text COLLATE pg_catalog."default" NOT NULL,
    apartment_number text COLLATE pg_catalog."default",
    coordinates geography(Point,4326) NOT NULL,
    CONSTRAINT locations_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.media
(
    id bigserial NOT NULL,
    property_id bigint NOT NULL,
    listing_id bigint,
    media_type text COLLATE pg_catalog."default" NOT NULL,
    url text COLLATE pg_catalog."default" NOT NULL,
    is_main boolean NOT NULL DEFAULT false,
    sort_order integer NOT NULL DEFAULT 0,
    CONSTRAINT media_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.messages
(
    id bigserial NOT NULL,
    conversation_id bigint NOT NULL,
    sender_id bigint NOT NULL,
    content text COLLATE pg_catalog."default" NOT NULL,
    sent_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT messages_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.neighborhood_data
(
    id bigserial NOT NULL,
    location_id bigint NOT NULL,
    category text COLLATE pg_catalog."default" NOT NULL,
    name text COLLATE pg_catalog."default" NOT NULL,
    score double precision NOT NULL,
    distance_meters integer NOT NULL,
    CONSTRAINT neighborhood_data_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.open_houses
(
    id bigserial NOT NULL,
    listing_id bigint NOT NULL,
    start_time timestamp with time zone NOT NULL,
    end_time timestamp with time zone NOT NULL,
    requires_registration boolean NOT NULL DEFAULT false,
    instructions text COLLATE pg_catalog."default" NOT NULL DEFAULT ''::text,
    CONSTRAINT open_houses_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.phone_reveal_logs
(
    id bigserial NOT NULL,
    listing_id bigint NOT NULL,
    user_id bigint,
    guest_session_id text COLLATE pg_catalog."default",
    revealed_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT phone_reveal_logs_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.promotions
(
    id bigserial NOT NULL,
    listing_id bigint NOT NULL,
    type text COLLATE pg_catalog."default" NOT NULL,
    start_date timestamp with time zone NOT NULL,
    end_date timestamp with time zone NOT NULL,
    CONSTRAINT promotions_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.properties
(
    id bigserial NOT NULL,
    location_id bigint NOT NULL,
    category_id bigint NOT NULL,
    area_sqm double precision NOT NULL,
    plot_area_sqm double precision,
    rooms integer NOT NULL,
    floor integer NOT NULL,
    year_built integer NOT NULL,
    heating_type text COLLATE pg_catalog."default" NOT NULL,
    extra_attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT properties_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.property_amenities
(
    property_id bigint NOT NULL,
    amenity_id bigint NOT NULL,
    CONSTRAINT property_amenities_pkey PRIMARY KEY (property_id, amenity_id)
);

CREATE TABLE IF NOT EXISTS public.property_histories
(
    id bigserial NOT NULL,
    property_id bigint NOT NULL,
    event_type text COLLATE pg_catalog."default" NOT NULL,
    event_date date NOT NULL,
    amount numeric(12, 2),
    price_per_sqm numeric(12, 2),
    description text COLLATE pg_catalog."default" NOT NULL,
    CONSTRAINT property_histories_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.property_owners
(
    property_id bigint NOT NULL,
    user_id bigint NOT NULL,
    ownership_share numeric(5, 2),
    CONSTRAINT property_owners_pkey PRIMARY KEY (property_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.saved_searches
(
    id bigserial NOT NULL,
    user_id bigint NOT NULL,
    name text COLLATE pg_catalog."default" NOT NULL,
    criteria jsonb NOT NULL DEFAULT '{}'::jsonb,
    notification_frequency text COLLATE pg_catalog."default" NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT saved_searches_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.sessions
(
    id bigserial NOT NULL,
    user_id bigint NOT NULL,
    token_hash text COLLATE pg_catalog."default" NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    revoked_at timestamp with time zone,
    CONSTRAINT sessions_pkey PRIMARY KEY (id),
    CONSTRAINT sessions_token_hash_key UNIQUE (token_hash)
);

CREATE TABLE IF NOT EXISTS public.subscription_plans
(
    id bigserial NOT NULL,
    name text COLLATE pg_catalog."default" NOT NULL,
    listing_limit integer NOT NULL,
    monthly_price numeric(12, 2) NOT NULL,
    CONSTRAINT subscription_plans_pkey PRIMARY KEY (id),
    CONSTRAINT subscription_plans_name_key UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS public.subscriptions
(
    id bigserial NOT NULL,
    account_id bigint NOT NULL,
    plan_id bigint NOT NULL,
    start_date timestamp with time zone NOT NULL,
    end_date timestamp with time zone NOT NULL,
    status text COLLATE pg_catalog."default" NOT NULL,
    payment_status text COLLATE pg_catalog."default" NOT NULL,
    CONSTRAINT subscriptions_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.users
(
    id bigserial NOT NULL,
    email text COLLATE pg_catalog."default" NOT NULL,
    password_hash text COLLATE pg_catalog."default" NOT NULL,
    role text COLLATE pg_catalog."default" NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    phone text COLLATE pg_catalog."default",
    business_role text COLLATE pg_catalog."default" NOT NULL DEFAULT 'buyer'::text,
    agency_id bigint,
    billing_account_id bigint,
    is_verified boolean NOT NULL DEFAULT false,
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT users_pkey PRIMARY KEY (id),
    CONSTRAINT users_email_key UNIQUE (email)
);

CREATE TABLE IF NOT EXISTS public.voivodeships
(
    id bigserial NOT NULL,
    name text COLLATE pg_catalog."default" NOT NULL,
    CONSTRAINT voivodeships_pkey PRIMARY KEY (id),
    CONSTRAINT voivodeships_name_key UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS public.wishlist_items
(
    id bigserial NOT NULL,
    wishlist_id bigint NOT NULL,
    listing_id bigint NOT NULL,
    added_at timestamp with time zone NOT NULL DEFAULT now(),
    user_notes text COLLATE pg_catalog."default" NOT NULL DEFAULT ''::text,
    CONSTRAINT wishlist_items_pkey PRIMARY KEY (id),
    CONSTRAINT wishlist_items_wishlist_id_listing_id_key UNIQUE (wishlist_id, listing_id)
);

CREATE TABLE IF NOT EXISTS public.wishlists
(
    id bigserial NOT NULL,
    user_id bigint NOT NULL,
    name text COLLATE pg_catalog."default" NOT NULL,
    color text COLLATE pg_catalog."default" NOT NULL DEFAULT 'sand'::text,
    is_shared boolean NOT NULL DEFAULT false,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT wishlists_pkey PRIMARY KEY (id)
);

ALTER TABLE IF EXISTS public.agencies
    ADD CONSTRAINT agencies_billing_account_id_fkey FOREIGN KEY (billing_account_id)
    REFERENCES public.billing_accounts (id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS agencies_billing_account_id_key
    ON public.agencies(billing_account_id);


ALTER TABLE IF EXISTS public.cities
    ADD CONSTRAINT cities_voivodeship_id_fkey FOREIGN KEY (voivodeship_id)
    REFERENCES public.voivodeships (id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE CASCADE;


ALTER TABLE IF EXISTS public.conversations
    ADD CONSTRAINT conversations_listing_id_fkey FOREIGN KEY (listing_id)
    REFERENCES public.listings (id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE SET NULL;


ALTER TABLE IF EXISTS public.conversations
    ADD CONSTRAINT conversations_participant_one_id_fkey FOREIGN KEY (participant_one_id)
    REFERENCES public.users (id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE CASCADE;


ALTER TABLE IF EXISTS public.conversations
    ADD CONSTRAINT conversations_participant_two_id_fkey FOREIGN KEY (participant_two_id)
    REFERENCES public.users (id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE CASCADE;


ALTER TABLE IF EXISTS public.districts
    ADD CONSTRAINT districts_city_id_fkey FOREIGN KEY (city_id)
    REFERENCES public.cities (id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE CASCADE;


ALTER TABLE IF EXISTS public.leads
    ADD CONSTRAINT leads_agency_id_fkey FOREIGN KEY (agency_id)
    REFERENCES public.agencies (id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE SET NULL;


ALTER TABLE IF EXISTS public.leads
    ADD CONSTRAINT leads_buyer_user_id_fkey FOREIGN KEY (buyer_user_id)
    REFERENCES public.users (id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE CASCADE;


ALTER TABLE IF EXISTS public.leads
    ADD CONSTRAINT leads_listing_id_fkey FOREIGN KEY (listing_id)
    REFERENCES public.listings (id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE SET NULL;


ALTER TABLE IF EXISTS public.leads
    ADD CONSTRAINT leads_saved_search_id_fkey FOREIGN KEY (saved_search_id)
    REFERENCES public.saved_searches (id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE SET NULL;


ALTER TABLE IF EXISTS public.leads
    ADD CONSTRAINT leads_seller_user_id_fkey FOREIGN KEY (seller_user_id)
    REFERENCES public.users (id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE SET NULL;


ALTER TABLE IF EXISTS public.listings
    ADD CONSTRAINT listings_property_id_fkey FOREIGN KEY (property_id)
    REFERENCES public.properties (id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS listings_property_id_idx
    ON public.listings(property_id);


ALTER TABLE IF EXISTS public.listings
    ADD CONSTRAINT listings_seller_user_id_fkey FOREIGN KEY (seller_user_id)
    REFERENCES public.users (id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS listings_seller_user_id_idx
    ON public.listings(seller_user_id);


ALTER TABLE IF EXISTS public.locations
    ADD CONSTRAINT locations_city_id_fkey FOREIGN KEY (city_id)
    REFERENCES public.cities (id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS locations_city_id_idx
    ON public.locations(city_id);


ALTER TABLE IF EXISTS public.locations
    ADD CONSTRAINT locations_district_id_fkey FOREIGN KEY (district_id)
    REFERENCES public.districts (id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS locations_district_id_idx
    ON public.locations(district_id);


ALTER TABLE IF EXISTS public.media
    ADD CONSTRAINT media_listing_id_fkey FOREIGN KEY (listing_id)
    REFERENCES public.listings (id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE CASCADE;


ALTER TABLE IF EXISTS public.media
    ADD CONSTRAINT media_property_id_fkey FOREIGN KEY (property_id)
    REFERENCES public.properties (id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE CASCADE;


ALTER TABLE IF EXISTS public.messages
    ADD CONSTRAINT messages_conversation_id_fkey FOREIGN KEY (conversation_id)
    REFERENCES public.conversations (id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE CASCADE;


ALTER TABLE IF EXISTS public.messages
    ADD CONSTRAINT messages_sender_id_fkey FOREIGN KEY (sender_id)
    REFERENCES public.users (id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE CASCADE;


ALTER TABLE IF EXISTS public.neighborhood_data
    ADD CONSTRAINT neighborhood_data_location_id_fkey FOREIGN KEY (location_id)
    REFERENCES public.locations (id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE CASCADE;


ALTER TABLE IF EXISTS public.open_houses
    ADD CONSTRAINT open_houses_listing_id_fkey FOREIGN KEY (listing_id)
    REFERENCES public.listings (id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE CASCADE;


ALTER TABLE IF EXISTS public.phone_reveal_logs
    ADD CONSTRAINT phone_reveal_logs_listing_id_fkey FOREIGN KEY (listing_id)
    REFERENCES public.listings (id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE CASCADE;


ALTER TABLE IF EXISTS public.phone_reveal_logs
    ADD CONSTRAINT phone_reveal_logs_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES public.users (id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE SET NULL;


ALTER TABLE IF EXISTS public.promotions
    ADD CONSTRAINT promotions_listing_id_fkey FOREIGN KEY (listing_id)
    REFERENCES public.listings (id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE CASCADE;


ALTER TABLE IF EXISTS public.properties
    ADD CONSTRAINT properties_category_id_fkey FOREIGN KEY (category_id)
    REFERENCES public.categories (id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE RESTRICT;


ALTER TABLE IF EXISTS public.properties
    ADD CONSTRAINT properties_location_id_fkey FOREIGN KEY (location_id)
    REFERENCES public.locations (id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE RESTRICT;


ALTER TABLE IF EXISTS public.property_amenities
    ADD CONSTRAINT property_amenities_amenity_id_fkey FOREIGN KEY (amenity_id)
    REFERENCES public.amenities (id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE CASCADE;


ALTER TABLE IF EXISTS public.property_amenities
    ADD CONSTRAINT property_amenities_property_id_fkey FOREIGN KEY (property_id)
    REFERENCES public.properties (id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE CASCADE;


ALTER TABLE IF EXISTS public.property_histories
    ADD CONSTRAINT property_histories_property_id_fkey FOREIGN KEY (property_id)
    REFERENCES public.properties (id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE CASCADE;


ALTER TABLE IF EXISTS public.property_owners
    ADD CONSTRAINT property_owners_property_id_fkey FOREIGN KEY (property_id)
    REFERENCES public.properties (id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE CASCADE;


ALTER TABLE IF EXISTS public.property_owners
    ADD CONSTRAINT property_owners_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES public.users (id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE CASCADE;


ALTER TABLE IF EXISTS public.saved_searches
    ADD CONSTRAINT saved_searches_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES public.users (id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE CASCADE;


ALTER TABLE IF EXISTS public.sessions
    ADD CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES public.users (id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS sessions_user_id_idx
    ON public.sessions(user_id);


ALTER TABLE IF EXISTS public.subscriptions
    ADD CONSTRAINT subscriptions_account_id_fkey FOREIGN KEY (account_id)
    REFERENCES public.billing_accounts (id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE CASCADE;


ALTER TABLE IF EXISTS public.subscriptions
    ADD CONSTRAINT subscriptions_plan_id_fkey FOREIGN KEY (plan_id)
    REFERENCES public.subscription_plans (id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE RESTRICT;


ALTER TABLE IF EXISTS public.users
    ADD CONSTRAINT users_agency_id_fkey FOREIGN KEY (agency_id)
    REFERENCES public.agencies (id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS users_agency_id_idx
    ON public.users(agency_id);


ALTER TABLE IF EXISTS public.users
    ADD CONSTRAINT users_billing_account_id_fkey FOREIGN KEY (billing_account_id)
    REFERENCES public.billing_accounts (id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS users_billing_account_id_idx
    ON public.users(billing_account_id);


ALTER TABLE IF EXISTS public.wishlist_items
    ADD CONSTRAINT wishlist_items_listing_id_fkey FOREIGN KEY (listing_id)
    REFERENCES public.listings (id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE CASCADE;


ALTER TABLE IF EXISTS public.wishlist_items
    ADD CONSTRAINT wishlist_items_wishlist_id_fkey FOREIGN KEY (wishlist_id)
    REFERENCES public.wishlists (id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE CASCADE;


ALTER TABLE IF EXISTS public.wishlists
    ADD CONSTRAINT wishlists_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES public.users (id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE CASCADE;

END;
