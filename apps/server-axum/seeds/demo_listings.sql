WITH demo_user AS (
    INSERT INTO users (
        email,
        password_hash,
        role,
        business_role,
        is_verified,
        created_at,
        updated_at
    )
    VALUES (
        'demo-agent@example.com',
        'demo-seed-password-hash',
        'user',
        'agent',
        TRUE,
        now() - interval '45 days',
        now()
    )
    ON CONFLICT (email) DO UPDATE
    SET role = EXCLUDED.role,
        business_role = EXCLUDED.business_role,
        is_verified = EXCLUDED.is_verified,
        updated_at = now()
    RETURNING id
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
    property_id,
    location_id,
    media_id,
    slug,
    transaction_type,
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
    USING demo_user
    WHERE listing.seller_user_id = demo_user.id
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
        demo_user.id,
        seed.transaction_type,
        seed.price,
        seed.slug,
        'active',
        now() - make_interval(days => seed.created_days_ago),
        now() - make_interval(hours => seed.updated_hours_ago),
        now() + make_interval(days => seed.expires_days_from_now)
    FROM listing_seed AS seed
    CROSS JOIN demo_user
    ON CONFLICT (slug) DO UPDATE
    SET property_id = EXCLUDED.property_id,
        seller_user_id = EXCLUDED.seller_user_id,
        transaction_type = EXCLUDED.transaction_type,
        price = EXCLUDED.price,
        status = EXCLUDED.status,
        updated_at = EXCLUDED.updated_at,
        expires_at = EXCLUDED.expires_at
    RETURNING id, slug
)
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
    sort_order = EXCLUDED.sort_order;
