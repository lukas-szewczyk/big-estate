use sqlx::PgPool;

use crate::error::ApiError;

const VOIVODESHIPS: &[(i64, &str)] = &[
    (1, "Dolnoslaskie"),
    (2, "Kujawsko-Pomorskie"),
    (3, "Lubelskie"),
    (4, "Lubuskie"),
    (5, "Lodzkie"),
    (6, "Malopolskie"),
    (7, "Mazowieckie"),
    (8, "Opolskie"),
    (9, "Podkarpackie"),
    (10, "Podlaskie"),
    (11, "Pomorskie"),
    (12, "Slaskie"),
    (13, "Swietokrzyskie"),
    (14, "Warminsko-Mazurskie"),
    (15, "Wielkopolskie"),
    (16, "Zachodniopomorskie"),
];

const CITIES: &[(i64, i64, &str)] = &[
    (101, 7, "Warszawa"),
    (102, 6, "Krakow"),
    (103, 11, "Gdansk"),
    (104, 1, "Wroclaw"),
    (105, 15, "Poznan"),
    (106, 5, "Lodz"),
    (107, 12, "Katowice"),
    (108, 9, "Rzeszow"),
    (109, 3, "Lublin"),
    (110, 16, "Szczecin"),
];

const DISTRICTS: &[(i64, i64, &str)] = &[
    (1001, 101, "Mokotow"),
    (1002, 101, "Srodmiescie"),
    (1003, 101, "Wilanow"),
    (1004, 101, "Wawer"),
    (1005, 102, "Stare Miasto"),
    (1006, 102, "Podgorze"),
    (1007, 102, "Krowodrza"),
    (1008, 103, "Wrzeszcz"),
    (1009, 103, "Oliwa"),
    (1010, 104, "Krzyki"),
    (1011, 104, "Srodmiescie"),
    (1012, 105, "Jezyce"),
    (1013, 105, "Stare Miasto"),
];

const CATEGORIES: &[(i64, &str)] = &[
    (1, "Apartment"),
    (2, "House"),
    (3, "Plot"),
    (4, "Commercial"),
];

const AMENITIES: &[(i64, &str, &str)] = &[
    (1, "Elevator", "building-2"),
    (2, "Balcony", "door-open"),
    (3, "Garden", "trees"),
    (4, "Garage", "car-front"),
    (5, "Security", "shield-check"),
    (6, "Air Conditioning", "wind"),
    (7, "Terrace", "sun"),
    (8, "Storage", "package"),
];

const SUBSCRIPTION_PLANS: &[(i64, &str, i32, &str)] = &[
    (1, "B2B Premium", 50, "499.00"),
    (2, "Private Plus", 5, "79.00"),
];

pub async fn seed_reference_data(pool: &PgPool) -> Result<(), ApiError> {
    let mut tx = pool.begin().await?;

    for (id, name) in VOIVODESHIPS {
        sqlx::query(
            r#"
            INSERT INTO voivodeships (id, name)
            VALUES ($1, $2)
            ON CONFLICT (id) DO UPDATE
            SET name = EXCLUDED.name
            "#,
        )
        .bind(id)
        .bind(*name)
        .execute(&mut *tx)
        .await?;
    }

    for (id, voivodeship_id, name) in CITIES {
        sqlx::query(
            r#"
            INSERT INTO cities (id, voivodeship_id, name)
            VALUES ($1, $2, $3)
            ON CONFLICT (id) DO UPDATE
            SET voivodeship_id = EXCLUDED.voivodeship_id,
                name = EXCLUDED.name
            "#,
        )
        .bind(id)
        .bind(voivodeship_id)
        .bind(*name)
        .execute(&mut *tx)
        .await?;
    }

    for (id, city_id, name) in DISTRICTS {
        sqlx::query(
            r#"
            INSERT INTO districts (id, city_id, name)
            VALUES ($1, $2, $3)
            ON CONFLICT (id) DO UPDATE
            SET city_id = EXCLUDED.city_id,
                name = EXCLUDED.name
            "#,
        )
        .bind(id)
        .bind(city_id)
        .bind(*name)
        .execute(&mut *tx)
        .await?;
    }

    for (id, name) in CATEGORIES {
        sqlx::query(
            r#"
            INSERT INTO categories (id, name)
            VALUES ($1, $2)
            ON CONFLICT (id) DO UPDATE
            SET name = EXCLUDED.name
            "#,
        )
        .bind(id)
        .bind(*name)
        .execute(&mut *tx)
        .await?;
    }

    for (id, name, icon_name) in AMENITIES {
        sqlx::query(
            r#"
            INSERT INTO amenities (id, name, icon_name)
            VALUES ($1, $2, $3)
            ON CONFLICT (id) DO UPDATE
            SET name = EXCLUDED.name,
                icon_name = EXCLUDED.icon_name
            "#,
        )
        .bind(id)
        .bind(*name)
        .bind(*icon_name)
        .execute(&mut *tx)
        .await?;
    }

    for (id, name, listing_limit, monthly_price) in SUBSCRIPTION_PLANS {
        sqlx::query(
            r#"
            INSERT INTO subscription_plans (id, name, listing_limit, monthly_price)
            VALUES ($1, $2, $3, $4::numeric)
            ON CONFLICT (id) DO UPDATE
            SET name = EXCLUDED.name,
                listing_limit = EXCLUDED.listing_limit,
                monthly_price = EXCLUDED.monthly_price
            "#,
        )
        .bind(id)
        .bind(*name)
        .bind(*listing_limit)
        .bind(*monthly_price)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    Ok(())
}
