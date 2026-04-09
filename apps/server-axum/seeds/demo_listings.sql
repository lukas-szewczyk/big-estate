-- Demo credentials:
--   demo-agent@example.com / secret-password
--   demo-owner@example.com / secret-password

INSERT INTO billing_accounts (id, account_type, created_at)
VALUES
    (980001, 'agency', now() - interval '120 days'),
    (980002, 'private', now() - interval '120 days')
ON CONFLICT (id) DO UPDATE
SET account_type = EXCLUDED.account_type;

INSERT INTO agencies (
    id,
    billing_account_id,
    company_name,
    nip,
    address,
    is_verified,
    created_at,
    updated_at
)
VALUES (
    980001,
    980001,
    'Demo Estates',
    '5210000000',
    'ul. Prosta 10, Warszawa',
    TRUE,
    now() - interval '120 days',
    now()
)
ON CONFLICT (id) DO UPDATE
SET billing_account_id = EXCLUDED.billing_account_id,
    company_name = EXCLUDED.company_name,
    nip = EXCLUDED.nip,
    address = EXCLUDED.address,
    is_verified = EXCLUDED.is_verified,
    updated_at = now();

INSERT INTO users (
    email,
    password_hash,
    role,
    business_role,
    phone,
    agency_id,
    billing_account_id,
    is_verified,
    created_at,
    updated_at
)
VALUES
    (
        'demo-agent@example.com',
        '$argon2id$v=19$m=19456,t=2,p=1$EuriJeoSoj3jnaGURHb2Ng$F1tk9/Wc1tyw4ApyHK9jLPvTRm3F1Cmr3uBrSgyH3hU',
        'user',
        'agent',
        '+48 500 100 100',
        980001,
        NULL,
        TRUE,
        now() - interval '90 days',
        now()
    ),
    (
        'demo-owner@example.com',
        '$argon2id$v=19$m=19456,t=2,p=1$EuriJeoSoj3jnaGURHb2Ng$F1tk9/Wc1tyw4ApyHK9jLPvTRm3F1Cmr3uBrSgyH3hU',
        'user',
        'owner',
        '+48 500 200 200',
        NULL,
        980002,
        TRUE,
        now() - interval '90 days',
        now()
    )
ON CONFLICT (email) DO UPDATE
SET password_hash = EXCLUDED.password_hash,
    role = EXCLUDED.role,
    business_role = EXCLUDED.business_role,
    phone = EXCLUDED.phone,
    agency_id = EXCLUDED.agency_id,
    billing_account_id = EXCLUDED.billing_account_id,
    is_verified = EXCLUDED.is_verified,
    updated_at = now();

DELETE FROM property_histories
WHERE property_id BETWEEN 910001 AND 920000;

DELETE FROM property_amenities
WHERE property_id BETWEEN 910001 AND 920000;

DELETE FROM property_owners
WHERE property_id BETWEEN 910001 AND 920000;

DELETE FROM open_houses
WHERE id BETWEEN 930001 AND 940000;

DELETE FROM wishlist_items
WHERE wishlist_id BETWEEN 970001 AND 970003;

DELETE FROM wishlists
WHERE id BETWEEN 970001 AND 970003;

WITH demo_agent AS (
    SELECT id
    FROM users
    WHERE email = 'demo-agent@example.com'
),
demo_owner AS (
    SELECT id
    FROM users
    WHERE email = 'demo-owner@example.com'
),
city_seed (
    city_slot,
    city_id,
    city_slug,
    center_lat,
    center_lng,
    postal_prefix,
    district_ids,
    street_names
) AS (
    VALUES
        (
            1,
            101,
            'warszawa',
            52.2297,
            21.0122,
            '00',
            ARRAY[1001, 1002, 1003, 1004]::bigint[],
            ARRAY['Pulawska', 'Marszalkowska', 'Aleje Jerozolimskie', 'Dobra', 'Wilanowska']::text[]
        ),
        (
            2,
            102,
            'krakow',
            50.0614,
            19.9366,
            '30',
            ARRAY[1005, 1006, 1007]::bigint[],
            ARRAY['Grodzka', 'Krowoderska', 'Starowislna', 'Miodowa', 'Kalwaryjska']::text[]
        ),
        (
            3,
            103,
            'gdansk',
            54.3520,
            18.6466,
            '80',
            ARRAY[1008, 1009]::bigint[],
            ARRAY['Grunwaldzka', 'Chmielna', 'Kartuska', 'Spacerowa', 'Dluga']::text[]
        ),
        (
            4,
            104,
            'wroclaw',
            51.1079,
            17.0385,
            '50',
            ARRAY[1010, 1011]::bigint[],
            ARRAY['Powstancow Slaskich', 'Legnicka', 'Jednosci Narodowej', 'Grabiszynska', 'Traugutta']::text[]
        ),
        (
            5,
            105,
            'poznan',
            52.4064,
            16.9252,
            '60',
            ARRAY[1012, 1013]::bigint[],
            ARRAY['Szamarzewskiego', 'Dabrowskiego', 'Bukowska', 'Glogowska', 'Piatkowska']::text[]
        ),
        (
            6,
            106,
            'lodz',
            51.7592,
            19.4560,
            '90',
            ARRAY[]::bigint[],
            ARRAY['Piotrkowska', 'Tuwima', 'Kopcinskiego', 'Pabianicka', 'Zgierska']::text[]
        ),
        (
            7,
            107,
            'katowice',
            50.2649,
            19.0238,
            '40',
            ARRAY[]::bigint[],
            ARRAY['Meteorologow', 'Kosciuszki', 'Francuska', 'Chorzowska', 'Mikolowska']::text[]
        ),
        (
            8,
            108,
            'rzeszow',
            50.0413,
            21.9990,
            '35',
            ARRAY[]::bigint[],
            ARRAY['Rejtana', 'Pilsudskiego', 'Krakowska', 'Lwowska', 'Dabrowskiego']::text[]
        ),
        (
            9,
            109,
            'lublin',
            51.2465,
            22.5684,
            '20',
            ARRAY[]::bigint[],
            ARRAY['Krakowskie Przedmiescie', 'Nadbystrzycka', 'Gleboka', 'Zelwerowicza', 'Kunickiego']::text[]
        ),
        (
            10,
            110,
            'szczecin',
            53.4285,
            14.5528,
            '70',
            ARRAY[]::bigint[],
            ARRAY['Bulwar Gdanski', 'Wojska Polskiego', 'Mieszka I', 'Jagiellonska', 'Kolumba']::text[]
        )
),
seed_base AS (
    SELECT
        seq,
        city.city_id,
        city.city_slug,
        city.center_lat,
        city.center_lng,
        city.postal_prefix,
        city.district_ids,
        city.street_names,
        ((seq - 1) % 4) + 1 AS category_id
    FROM generate_series(1, 10000) AS seq
    INNER JOIN city_seed AS city
        ON city.city_slot = 1 + ((seq - 1) % 10)
),
listing_seed (
    seed_index,
    property_id,
    location_id,
    media_id,
    slug,
    transaction_type,
    listing_status,
    price,
    city_id,
    district_id,
    street,
    postal_code,
    building_number,
    apartment_number,
    latitude,
    longitude,
    category_id,
    area_sqm,
    plot_area_sqm,
    rooms,
    floor,
    year_built,
    heating_type,
    extra_attributes,
    thumbnail_url,
    created_days_ago,
    updated_hours_ago,
    expires_days_from_now
) AS (
    SELECT
        seed.seq AS seed_index,
        910000 + seed.seq AS property_id,
        900000 + seed.seq AS location_id,
        920000 + seed.seq AS media_id,
        format(
            'demo-poland-%s-%s',
            seed.city_slug,
            lpad(seed.seq::text, 5, '0')
        ) AS slug,
        CASE
            WHEN seed.category_id = 3 THEN 'sale'
            WHEN seed.category_id = 4 AND seed.seq % 3 = 0 THEN 'rent'
            WHEN seed.category_id = 2 AND seed.seq % 6 = 0 THEN 'rent'
            WHEN seed.category_id = 1 AND seed.seq % 4 = 0 THEN 'rent'
            ELSE 'sale'
        END AS transaction_type,
        CASE
            WHEN seed.seq % 19 = 0 THEN 'sold'
            WHEN seed.seq % 13 = 0 THEN 'expired'
            WHEN seed.seq % 7 = 0 THEN 'draft'
            ELSE 'active'
        END AS listing_status,
        round(
            (
                CASE
                    WHEN seed.category_id = 1 AND seed.seq % 4 = 0
                        THEN apartment_area_sqm * (55 + (seed.seq % 35))
                    WHEN seed.category_id = 2 AND seed.seq % 6 = 0
                        THEN house_area_sqm * (34 + (seed.seq % 22))
                    WHEN seed.category_id = 4 AND seed.seq % 3 = 0
                        THEN commercial_area_sqm * (42 + (seed.seq % 30))
                    WHEN seed.category_id = 1
                        THEN apartment_area_sqm * (9800 + ((seed.seq * 29) % 7600))
                    WHEN seed.category_id = 2
                        THEN house_area_sqm * (7200 + ((seed.seq * 17) % 5200))
                    WHEN seed.category_id = 3
                        THEN plot_area_sqm_value * (180 + ((seed.seq * 13) % 260))
                    ELSE commercial_area_sqm * (6800 + ((seed.seq * 19) % 5400))
                END
            )::numeric,
            2
        ) AS price,
        seed.city_id,
        CASE
            WHEN cardinality(seed.district_ids) = 0 THEN NULL
            ELSE seed.district_ids[
                1 + (((seed.seq - 1) / 10) % cardinality(seed.district_ids))
            ]
        END AS district_id,
        seed.street_names[
            1 + (((seed.seq - 1) / 20) % cardinality(seed.street_names))
        ] AS street,
        seed.postal_prefix || '-' || lpad((((seed.seq * 37) % 900) + 100)::text, 3, '0') AS postal_code,
        (((seed.seq * 7) % 180) + 1)::text AS building_number,
        CASE
            WHEN seed.category_id IN (1, 4) AND seed.seq % 5 <> 0
                THEN (((seed.seq * 11) % 60) + 1)::text
            ELSE NULL
        END AS apartment_number,
        round(
            (
                seed.center_lat
                + ((((seed.seq * 17) % 61) - 30)::numeric / 2000.0)
                + (((seed.seq % 7) - 3)::numeric / 10000.0)
            )::numeric,
            6
        ) AS latitude,
        round(
            (
                seed.center_lng
                + ((((seed.seq * 29) % 61) - 30)::numeric / 1800.0)
                + (((seed.seq % 5) - 2)::numeric / 12000.0)
            )::numeric,
            6
        ) AS longitude,
        seed.category_id,
        CASE
            WHEN seed.category_id = 1 THEN apartment_area_sqm
            WHEN seed.category_id = 2 THEN house_area_sqm
            WHEN seed.category_id = 3 THEN 1.0
            ELSE commercial_area_sqm
        END AS area_sqm,
        CASE
            WHEN seed.category_id = 2 THEN house_plot_area_sqm
            WHEN seed.category_id = 3 THEN plot_area_sqm_value
            ELSE NULL
        END AS plot_area_sqm,
        CASE
            WHEN seed.category_id = 1 THEN 1 + (seed.seq % 5)
            WHEN seed.category_id = 2 THEN 3 + (seed.seq % 5)
            WHEN seed.category_id = 3 THEN 0
            ELSE 2 + (seed.seq % 7)
        END AS rooms,
        CASE
            WHEN seed.category_id = 1 THEN seed.seq % 9
            WHEN seed.category_id = 4 THEN 1 + (seed.seq % 12)
            ELSE 0
        END AS floor,
        1996 + (seed.seq % 29) AS year_built,
        CASE
            WHEN seed.category_id = 1 THEN
                (ARRAY['district', 'gas', 'electric', 'heat-pump'])[
                    1 + (seed.seq % 4)
                ]
            WHEN seed.category_id = 2 THEN
                (ARRAY['gas', 'heat-pump', 'electric', 'pellet'])[
                    1 + (seed.seq % 4)
                ]
            WHEN seed.category_id = 3 THEN 'none'
            ELSE
                (ARRAY['district', 'electric', 'gas'])[
                    1 + (seed.seq % 3)
                ]
        END AS heating_type,
        jsonb_strip_nulls(
            jsonb_build_object(
                'seedIndex', seed.seq,
                'balcony', seed.category_id = 1 AND seed.seq % 2 = 0,
                'garden', seed.category_id = 2 AND seed.seq % 2 = 1,
                'parking', seed.seq % 3 = 0,
                'elevator', seed.category_id IN (1, 4) AND seed.seq % 4 = 0,
                'investmentGrade', seed.category_id = 3,
                'fitOutReady', seed.category_id = 4 AND seed.seq % 3 = 0
            )
        ) AS extra_attributes,
        format(
            'https://picsum.photos/seed/poland-listing-%s/960/720',
            seed.seq
        ) AS thumbnail_url,
        1 + (seed.seq % 180) AS created_days_ago,
        seed.seq % 240 AS updated_hours_ago,
        21 + (seed.seq % 180) AS expires_days_from_now
    FROM (
        SELECT
            base.*,
            round((38 + ((base.seq * 13) % 78) + ((base.seq % 10)::numeric / 10.0))::numeric, 1) AS apartment_area_sqm,
            round((96 + ((base.seq * 17) % 176) + ((base.seq % 10)::numeric / 10.0))::numeric, 1) AS house_area_sqm,
            round((58 + ((base.seq * 11) % 285) + ((base.seq % 10)::numeric / 10.0))::numeric, 1) AS commercial_area_sqm,
            round((240 + ((base.seq * 23) % 900) + ((base.seq % 10)::numeric / 10.0))::numeric, 1) AS house_plot_area_sqm,
            round((650 + ((base.seq * 29) % 2600) + ((base.seq % 10)::numeric / 10.0))::numeric, 1) AS plot_area_sqm_value
        FROM seed_base AS base
    ) AS seed
),
delete_old_demo_listings AS (
    DELETE FROM listings AS listing
    USING demo_agent
    WHERE listing.seller_user_id = demo_agent.id
      AND listing.property_id BETWEEN 910001 AND 920000
      AND NOT EXISTS (
          SELECT 1
          FROM listing_seed
          WHERE listing_seed.slug = listing.slug
      )
    RETURNING listing.id
),
delete_old_demo_properties AS (
    DELETE FROM properties AS property
    WHERE property.id BETWEEN 910001 AND 920000
      AND NOT EXISTS (
          SELECT 1
          FROM listing_seed
          WHERE listing_seed.property_id = property.id
      )
    RETURNING property.id
),
delete_old_demo_locations AS (
    DELETE FROM locations AS location
    WHERE location.id BETWEEN 900001 AND 910000
      AND NOT EXISTS (
          SELECT 1
          FROM listing_seed
          WHERE listing_seed.location_id = location.id
      )
    RETURNING location.id
),
upsert_locations AS (
    INSERT INTO locations (
        id,
        city_id,
        district_id,
        street,
        postal_code,
        building_number,
        apartment_number,
        coordinates
    )
    SELECT
        location_id,
        city_id,
        district_id,
        street,
        postal_code,
        building_number,
        apartment_number,
        ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
    FROM listing_seed
    ON CONFLICT (id) DO UPDATE
    SET city_id = EXCLUDED.city_id,
        district_id = EXCLUDED.district_id,
        street = EXCLUDED.street,
        postal_code = EXCLUDED.postal_code,
        building_number = EXCLUDED.building_number,
        apartment_number = EXCLUDED.apartment_number,
        coordinates = EXCLUDED.coordinates
    RETURNING id
),
upsert_properties AS (
    INSERT INTO properties (
        id,
        location_id,
        category_id,
        area_sqm,
        plot_area_sqm,
        rooms,
        floor,
        year_built,
        heating_type,
        extra_attributes,
        created_at,
        updated_at
    )
    SELECT
        property_id,
        location_id,
        category_id,
        area_sqm,
        plot_area_sqm,
        rooms,
        floor,
        year_built,
        heating_type,
        extra_attributes,
        now() - make_interval(days => created_days_ago),
        now() - make_interval(hours => updated_hours_ago)
    FROM listing_seed
    ON CONFLICT (id) DO UPDATE
    SET location_id = EXCLUDED.location_id,
        category_id = EXCLUDED.category_id,
        area_sqm = EXCLUDED.area_sqm,
        plot_area_sqm = EXCLUDED.plot_area_sqm,
        rooms = EXCLUDED.rooms,
        floor = EXCLUDED.floor,
        year_built = EXCLUDED.year_built,
        heating_type = EXCLUDED.heating_type,
        extra_attributes = EXCLUDED.extra_attributes,
        updated_at = EXCLUDED.updated_at
    RETURNING id
),
insert_demo_property_owners AS (
    INSERT INTO property_owners (
        property_id,
        user_id,
        ownership_share
    )
    SELECT
        seed.property_id,
        demo_owner.id,
        100.0
    FROM listing_seed AS seed
    CROSS JOIN demo_owner
    ON CONFLICT (property_id, user_id) DO UPDATE
    SET ownership_share = EXCLUDED.ownership_share
    RETURNING property_id
),
amenity_seed AS (
    SELECT
        seed.property_id,
        CASE
            WHEN seed.category_id = 1 AND seed.seed_index % 2 = 0 THEN 2
            WHEN seed.category_id = 1 THEN 1
            WHEN seed.category_id = 2 AND seed.seed_index % 2 = 0 THEN 4
            WHEN seed.category_id = 2 THEN 3
            WHEN seed.category_id = 3 THEN 8
            WHEN seed.seed_index % 2 = 0 THEN 6
            ELSE 5
        END AS amenity_id
    FROM listing_seed AS seed
    UNION ALL
    SELECT
        seed.property_id,
        CASE
            WHEN seed.category_id = 1 THEN 1
            WHEN seed.category_id = 2 THEN 7
            WHEN seed.category_id = 3 THEN 5
            ELSE 8
        END AS amenity_id
    FROM listing_seed AS seed
    WHERE seed.seed_index % 3 = 0
),
insert_demo_property_amenities AS (
    INSERT INTO property_amenities (
        property_id,
        amenity_id
    )
    SELECT DISTINCT
        property_id,
        amenity_id
    FROM amenity_seed
    ON CONFLICT (property_id, amenity_id) DO NOTHING
    RETURNING property_id
),
upsert_listings AS (
    INSERT INTO listings (
        property_id,
        seller_user_id,
        transaction_type,
        price,
        slug,
        status,
        created_at,
        updated_at,
        expires_at
    )
    SELECT
        seed.property_id,
        demo_agent.id,
        seed.transaction_type,
        seed.price,
        seed.slug,
        seed.listing_status,
        now() - make_interval(days => seed.created_days_ago),
        now() - make_interval(hours => seed.updated_hours_ago),
        now() + make_interval(days => seed.expires_days_from_now)
    FROM listing_seed AS seed
    CROSS JOIN demo_agent
    ON CONFLICT (slug) DO UPDATE
    SET property_id = EXCLUDED.property_id,
        seller_user_id = EXCLUDED.seller_user_id,
        transaction_type = EXCLUDED.transaction_type,
        price = EXCLUDED.price,
        status = EXCLUDED.status,
        updated_at = EXCLUDED.updated_at,
        expires_at = EXCLUDED.expires_at
    RETURNING id, slug
),
upsert_media AS (
    INSERT INTO media (
        id,
        property_id,
        listing_id,
        media_type,
        url,
        is_main,
        sort_order
    )
    SELECT
        seed.media_id,
        seed.property_id,
        listing_row.id,
        'photo',
        seed.thumbnail_url,
        TRUE,
        0
    FROM listing_seed AS seed
    INNER JOIN upsert_listings AS listing_row
        ON listing_row.slug = seed.slug
    ON CONFLICT (id) DO UPDATE
    SET property_id = EXCLUDED.property_id,
        listing_id = EXCLUDED.listing_id,
        media_type = EXCLUDED.media_type,
        url = EXCLUDED.url,
        is_main = EXCLUDED.is_main,
        sort_order = EXCLUDED.sort_order
    RETURNING id
),
open_house_seed AS (
    SELECT
        930000 + seed.seed_index AS open_house_id,
        listing_row.id AS listing_id,
        now()
            + make_interval(days => 3 + (seed.seed_index % 21))
            + make_interval(hours => 9 + (seed.seed_index % 5)) AS start_time,
        now()
            + make_interval(days => 3 + (seed.seed_index % 21))
            + make_interval(hours => 11 + (seed.seed_index % 5)) AS end_time,
        seed.seed_index % 2 = 0 AS requires_registration,
        format(
            'Open house for %s in %s',
            seed.slug,
            seed.street
        ) AS instructions
    FROM listing_seed AS seed
    INNER JOIN upsert_listings AS listing_row
        ON listing_row.slug = seed.slug
    WHERE seed.listing_status = 'active'
      AND seed.transaction_type = 'sale'
      AND seed.seed_index % 37 = 0
),
upsert_open_houses AS (
    INSERT INTO open_houses (
        id,
        listing_id,
        start_time,
        end_time,
        requires_registration,
        instructions
    )
    SELECT
        open_house_id,
        listing_id,
        start_time,
        end_time,
        requires_registration,
        instructions
    FROM open_house_seed
    ON CONFLICT (id) DO UPDATE
    SET listing_id = EXCLUDED.listing_id,
        start_time = EXCLUDED.start_time,
        end_time = EXCLUDED.end_time,
        requires_registration = EXCLUDED.requires_registration,
        instructions = EXCLUDED.instructions
    RETURNING id
),
property_history_seed AS (
    SELECT
        940000 + seed.seed_index AS history_id,
        seed.property_id,
        'Listed'::text AS event_type,
        (now() - make_interval(days => seed.created_days_ago))::date AS event_date,
        seed.price AS amount,
        round((seed.price / NULLIF(seed.area_sqm, 0))::numeric, 2) AS price_per_sqm,
        'Demo listing created'::text AS description
    FROM listing_seed AS seed
    UNION ALL
    SELECT
        950000 + seed.seed_index AS history_id,
        seed.property_id,
        'PriceChange'::text AS event_type,
        (now() - make_interval(days => GREATEST(1, seed.created_days_ago / 2)))::date AS event_date,
        round((seed.price * 0.97)::numeric, 2) AS amount,
        round(((seed.price * 0.97) / NULLIF(seed.area_sqm, 0))::numeric, 2) AS price_per_sqm,
        'Demo price adjustment'::text AS description
    FROM listing_seed AS seed
    WHERE seed.seed_index % 9 = 0
    UNION ALL
    SELECT
        960000 + seed.seed_index AS history_id,
        seed.property_id,
        'Sold'::text AS event_type,
        (now() - make_interval(days => GREATEST(1, seed.created_days_ago / 3)))::date AS event_date,
        seed.price AS amount,
        round((seed.price / NULLIF(seed.area_sqm, 0))::numeric, 2) AS price_per_sqm,
        'Demo sale closed'::text AS description
    FROM listing_seed AS seed
    WHERE seed.listing_status = 'sold'
),
upsert_property_histories AS (
    INSERT INTO property_histories (
        id,
        property_id,
        event_type,
        event_date,
        amount,
        price_per_sqm,
        description
    )
    SELECT
        history_id,
        property_id,
        event_type,
        event_date,
        amount,
        price_per_sqm,
        description
    FROM property_history_seed
    ON CONFLICT (id) DO UPDATE
    SET property_id = EXCLUDED.property_id,
        event_type = EXCLUDED.event_type,
        event_date = EXCLUDED.event_date,
        amount = EXCLUDED.amount,
        price_per_sqm = EXCLUDED.price_per_sqm,
        description = EXCLUDED.description
    RETURNING id
),
upsert_demo_wishlists AS (
    INSERT INTO wishlists (
        id,
        user_id,
        name,
        color,
        is_shared,
        created_at
    )
    SELECT
        970001,
        demo_agent.id,
        'Szybki kontakt',
        'amber',
        FALSE,
        now() - interval '14 days'
    FROM demo_agent
    UNION ALL
    SELECT
        970002,
        demo_owner.id,
        'Rodzinne typy',
        'rose',
        FALSE,
        now() - interval '10 days'
    FROM demo_owner
    UNION ALL
    SELECT
        970003,
        demo_owner.id,
        'Inwestycyjne',
        'sky',
        FALSE,
        now() - interval '7 days'
    FROM demo_owner
    ON CONFLICT (id) DO UPDATE
    SET user_id = EXCLUDED.user_id,
        name = EXCLUDED.name,
        color = EXCLUDED.color,
        is_shared = EXCLUDED.is_shared
    RETURNING id
),
wishlist_item_agent_seed AS (
    SELECT
        970001 AS wishlist_id,
        listing_row.id AS listing_id,
        format('Agent shortlist #%s', seed.seed_index) AS user_notes
    FROM listing_seed AS seed
    INNER JOIN upsert_listings AS listing_row
        ON listing_row.slug = seed.slug
    WHERE seed.listing_status = 'active'
      AND seed.transaction_type = 'sale'
      AND seed.seed_index % 17 = 0
    ORDER BY seed.seed_index
    LIMIT 6
),
wishlist_item_owner_seed AS (
    SELECT
        970002 AS wishlist_id,
        listing_row.id AS listing_id,
        format('Rodzina sprawdza #%s', seed.seed_index) AS user_notes
    FROM listing_seed AS seed
    INNER JOIN upsert_listings AS listing_row
        ON listing_row.slug = seed.slug
    WHERE seed.category_id IN (1, 2)
      AND seed.listing_status IN ('active', 'draft')
      AND seed.seed_index % 23 = 0
    ORDER BY seed.seed_index
    LIMIT 6
),
wishlist_item_investment_seed AS (
    SELECT
        970003 AS wishlist_id,
        listing_row.id AS listing_id,
        format('ROI candidate #%s', seed.seed_index) AS user_notes
    FROM listing_seed AS seed
    INNER JOIN upsert_listings AS listing_row
        ON listing_row.slug = seed.slug
    WHERE seed.category_id IN (3, 4)
      AND seed.listing_status IN ('active', 'sold', 'expired')
      AND seed.seed_index % 29 = 0
    ORDER BY seed.seed_index
    LIMIT 6
),
wishlist_item_seed AS (
    SELECT * FROM wishlist_item_agent_seed
    UNION ALL
    SELECT * FROM wishlist_item_owner_seed
    UNION ALL
    SELECT * FROM wishlist_item_investment_seed
),
insert_demo_wishlist_items AS (
    INSERT INTO wishlist_items (
        wishlist_id,
        listing_id,
        user_notes,
        added_at
    )
    SELECT
        wishlist_id,
        listing_id,
        user_notes,
        now() - interval '2 days'
    FROM wishlist_item_seed
    RETURNING id
)
SELECT
    (SELECT COUNT(*) FROM listing_seed) AS seeded_listings,
    (SELECT COUNT(*) FROM insert_demo_property_owners) AS seeded_property_owners,
    (SELECT COUNT(*) FROM insert_demo_property_amenities) AS seeded_property_amenities,
    (SELECT COUNT(*) FROM upsert_open_houses) AS seeded_open_houses,
    (SELECT COUNT(*) FROM upsert_property_histories) AS seeded_property_histories,
    (SELECT COUNT(*) FROM upsert_demo_wishlists) AS seeded_wishlists,
    (SELECT COUNT(*) FROM insert_demo_wishlist_items) AS seeded_wishlist_items;
