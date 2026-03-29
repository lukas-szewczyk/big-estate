erDiagram
    %% SŁOWNIKI GEOGRAFICZNE (TERYT-lite)
    DICT_VOIVODESHIP {
        int voivodeship_id PK
        string name
    }
    DICT_CITY {
        int city_id PK
        int voivodeship_id FK
        string name
    }
    DICT_DISTRICT {
        int district_id PK
        int city_id FK
        string name
    }

    %% ROZLICZENIA I SUBSKRYPCJE
    BILLING_ACCOUNT {
        int account_id PK
        string account_type "Agency, Private"
        datetime created_at
    }
    SUBSCRIPTION_PLAN {
        int plan_id PK
        string name "e.g., B2B Premium"
        int listing_limit
        decimal monthly_price
    }
    SUBSCRIPTION {
        int subscription_id PK
        int account_id FK
        int plan_id FK
        datetime start_date
        datetime end_date
        string status "Active, Expired, Cancelled"
        string payment_status "Paid, Pending"
    }

    %% UŻYTKOWNICY I AGENCJE
    USER {
        int user_id PK
        string email
        string password_hash
        string phone
        string role "Buyer, Agent, Developer, Owner"
        int agency_id FK "nullable"
        int billing_account_id FK "nullable - dla pryw. wystawiających"
        boolean is_verified "Zaufany profil"
        datetime created_at
        datetime updated_at
    }
    AGENCY {
        int agency_id PK
        int billing_account_id FK "Konto do faktur"
        string company_name
        string nip
        string address
        boolean is_verified "Zweryfikowany partner"
        datetime created_at
        datetime updated_at
    }

    %% NIERUCHOMOŚCI I LOKALIZACJA
    LOCATION {
        int location_id PK
        int city_id FK
        int district_id FK "nullable"
        string street
        string postal_code
        string building_number
        string apartment_number "nullable"
        geometry coordinates "PostGIS (lat, lng)"
    }
    NEIGHBORHOOD_DATA {
        int data_id PK
        int location_id FK
        string category "School, Park, Transport, Crime"
        string name
        float score
        int distance_meters
    }
    CATEGORY {
        int category_id PK
        string name "Apartment, House, Plot, Commercial"
    }
    AMENITY {
        int amenity_id PK
        string name "np. Winda, Balkon"
        string icon_name "do UI"
    }
    PROPERTY {
        int property_id PK
        int location_id FK
        int category_id FK
        float area_sqm
        float plot_area_sqm "nullable"
        int rooms
        int floor
        int year_built
        string heating_type
        jsonb extra_attributes
        datetime created_at
        datetime updated_at
    }
    PROPERTY_OWNER {
        int property_id FK
        int user_id FK "Faktyczny właściciel"
        float ownership_share "Opcjonalnie: udział %"
    }
    PROPERTY_AMENITY {
        int property_id FK
        int amenity_id FK
    }
    PROPERTY_HISTORY {
        int history_id PK
        int property_id FK
        string event_type "Sold, Listed, PriceChange"
        date event_date
        decimal amount "nullable"
        decimal price_per_sqm "Wyliczona cena za m2"
        string description
    }

    %% OGŁOSZENIA (LISTINGS)
    LISTING {
        int listing_id PK
        int property_id FK
        int seller_user_id FK "Agent lub Właściciel"
        string transaction_type "Sale, Rent"
        decimal price
        string slug "SEO: /dom-wawer-sprzedaz..."
        string status "Active, Draft, Sold, Expired"
        datetime created_at
        datetime updated_at
        datetime expires_at
    }
    MEDIA {
        int media_id PK
        int property_id FK
        int listing_id FK "nullable"
        string media_type "Photo, Video, 3D_Tour"
        string url
        boolean is_main
        int sort_order
    }
    OPEN_HOUSE {
        int open_house_id PK
        int listing_id FK
        datetime start_time
        datetime end_time
        boolean requires_registration
        string instructions
    }
    PROMOTION {
        int promotion_id PK
        int listing_id FK
        string type "Highlight, Top, Homepage"
        datetime start_date
        datetime end_date
    }

    %% POPYT I ŚLEDZENIE
    WISHLIST {
        int wishlist_id PK
        int user_id FK
        string name
        boolean is_shared
        datetime created_at
    }
    WISHLIST_ITEM {
        int item_id PK
        int wishlist_id FK
        int listing_id FK
        datetime added_at
        string user_notes
    }
    SAVED_SEARCH {
        int search_id PK
        int user_id FK
        string name
        jsonb criteria
        string notification_frequency
        datetime created_at
    }

    %% LEADY I KOMUNIKACJA
    LEAD {
        int lead_id PK
        int buyer_user_id FK
        int listing_id FK "nullable"
        int agency_id FK "nullable"
        int seller_user_id FK "nullable"
        int saved_search_id FK "nullable - Źródło autogenerowane"
        string source "Wishlist, Message, Saved Search"
        int match_score
        string status "New, Contacted, Closed"
        datetime generated_at
    }
    PHONE_REVEAL_LOG {
        int log_id PK
        int listing_id FK
        int user_id FK "nullable (jeśli gość)"
        string guest_session_id "do analityki niezalogowanych"
        datetime revealed_at
    }
    CONVERSATION {
        int conversation_id PK
        int listing_id FK "nullable"
        int participant_one_id FK
        int participant_two_id FK
        datetime created_at
        datetime updated_at
    }
    MESSAGE {
        int message_id PK
        int conversation_id FK
        int sender_id FK
        string content
        datetime sent_at
    }

    %% === RELACJE ===
    
    %% Słowniki geograficzne
    DICT_VOIVODESHIP ||--o{ DICT_CITY : "zawiera"
    DICT_CITY ||--o{ DICT_DISTRICT : "zawiera"
    DICT_CITY ||--o{ LOCATION : "określa miasto"
    DICT_DISTRICT ||--o{ LOCATION : "określa dzielnicę"

    %% Subskrypcje i Rozliczenia
    BILLING_ACCOUNT ||--o{ SUBSCRIPTION : "opłaca"
    SUBSCRIPTION_PLAN ||--o{ SUBSCRIPTION : "jest planem dla"
    AGENCY ||--|| BILLING_ACCOUNT : "posiada konto B2B"
    USER ||--o| BILLING_ACCOUNT : "może mieć konto B2C"
    AGENCY ||--o{ USER : "zatrudnia"

    %% Nieruchomości
    LOCATION ||--o{ PROPERTY : "mieści"
    LOCATION ||--o{ NEIGHBORHOOD_DATA : "posiada dane POI"
    CATEGORY ||--o{ PROPERTY : "klasyfikuje"
    PROPERTY ||--o{ PROPERTY_AMENITY : "posiada"
    AMENITY ||--o{ PROPERTY_AMENITY : "przypisane do"
    PROPERTY ||--o{ PROPERTY_HISTORY : "archiwum"
    PROPERTY ||--o{ MEDIA : "galeria obiektu"
    
    %% Własność Nieruchomości
    USER ||--o{ PROPERTY_OWNER : "jest właścicielem"
    PROPERTY ||--o{ PROPERTY_OWNER : "ma przypisanych"

    %% Ogłoszenia
    PROPERTY ||--o{ LISTING : "jest wystawiana jako"
    USER ||--o{ LISTING : "wystawia"
    LISTING ||--o{ MEDIA : "dedykowane multimedia"
    LISTING ||--o{ OPEN_HOUSE : "dni otwarte"
    LISTING ||--o{ PROMOTION : "jest promowane"

    %% Popyt (Kupujący)
    USER ||--o{ WISHLIST : "tworzy"
    WISHLIST ||--o{ WISHLIST_ITEM : "zawiera"
    LISTING ||--o{ WISHLIST_ITEM : "dodane do"
    USER ||--o{ SAVED_SEARCH : "subskrybuje"

    %% Interakcje i Leady
    USER ||--o{ LEAD : "generuje"
    LISTING ||--o{ LEAD : "przyciąga"
    AGENCY ||--o{ LEAD : "obsługuje"
    SAVED_SEARCH ||--o{ LEAD : "wyzwala (powiązanie)"
    
    LISTING ||--o{ PHONE_REVEAL_LOG : "monetyzacja/śledzenie"
    USER ||--o{ PHONE_REVEAL_LOG : "klika 'Pokaż numer'"

    USER ||--o{ CONVERSATION : "uczestniczy w"
    LISTING ||--o{ CONVERSATION : "temat"
    CONVERSATION ||--o{ MESSAGE : "zawiera"
    USER ||--o{ MESSAGE : "wysyła"
