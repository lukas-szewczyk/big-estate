use serde::{Deserialize, Serialize};

use crate::error::ApiError;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PlatformRole {
    Admin,
    User,
}

impl PlatformRole {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Admin => "admin",
            Self::User => "user",
        }
    }
}

impl TryFrom<&str> for PlatformRole {
    type Error = String;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "admin" => Ok(Self::Admin),
            "user" => Ok(Self::User),
            other => Err(format!("unknown platform role {other}")),
        }
    }
}

impl TryFrom<String> for PlatformRole {
    type Error = String;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::try_from(value.as_str())
    }
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum BusinessRole {
    Buyer,
    Agent,
    Developer,
    Owner,
}

impl BusinessRole {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Buyer => "buyer",
            Self::Agent => "agent",
            Self::Developer => "developer",
            Self::Owner => "owner",
        }
    }
}

impl TryFrom<&str> for BusinessRole {
    type Error = String;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "buyer" => Ok(Self::Buyer),
            "agent" => Ok(Self::Agent),
            "developer" => Ok(Self::Developer),
            "owner" => Ok(Self::Owner),
            other => Err(format!("unknown business role {other}")),
        }
    }
}

impl TryFrom<String> for BusinessRole {
    type Error = String;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::try_from(value.as_str())
    }
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TransactionType {
    Sale,
    Rent,
}

impl TransactionType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Sale => "sale",
            Self::Rent => "rent",
        }
    }
}

impl TryFrom<&str> for TransactionType {
    type Error = String;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "sale" => Ok(Self::Sale),
            "rent" => Ok(Self::Rent),
            other => Err(format!("unknown transaction type {other}")),
        }
    }
}

impl TryFrom<String> for TransactionType {
    type Error = String;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::try_from(value.as_str())
    }
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ListingStatus {
    Active,
    Draft,
    Sold,
    Expired,
}

impl ListingStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::Draft => "draft",
            Self::Sold => "sold",
            Self::Expired => "expired",
        }
    }
}

impl TryFrom<&str> for ListingStatus {
    type Error = String;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "active" => Ok(Self::Active),
            "draft" => Ok(Self::Draft),
            "sold" => Ok(Self::Sold),
            "expired" => Ok(Self::Expired),
            other => Err(format!("unknown listing status {other}")),
        }
    }
}

impl TryFrom<String> for ListingStatus {
    type Error = String;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::try_from(value.as_str())
    }
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MediaType {
    Photo,
    Video,
    #[serde(rename = "3d_tour")]
    Tour3d,
}

impl MediaType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Photo => "photo",
            Self::Video => "video",
            Self::Tour3d => "3d_tour",
        }
    }
}

impl TryFrom<&str> for MediaType {
    type Error = String;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "photo" => Ok(Self::Photo),
            "video" => Ok(Self::Video),
            "3d_tour" => Ok(Self::Tour3d),
            other => Err(format!("unknown media type {other}")),
        }
    }
}

impl TryFrom<String> for MediaType {
    type Error = String;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::try_from(value.as_str())
    }
}

#[derive(Clone, Debug, Deserialize)]
pub struct PaginationQuery {
    pub page: Option<u64>,
    pub per_page: Option<u64>,
}

#[derive(Clone, Copy, Debug)]
pub struct Pagination {
    pub page: u64,
    pub per_page: u64,
    pub limit: i64,
    pub offset: i64,
}

impl PaginationQuery {
    pub fn normalize(&self) -> Pagination {
        let page = self.page.unwrap_or(1).max(1);
        let per_page = self.per_page.unwrap_or(20).clamp(1, 100);
        Pagination {
            page,
            per_page,
            limit: per_page as i64,
            offset: ((page - 1) * per_page) as i64,
        }
    }
}

impl Default for PaginationQuery {
    fn default() -> Self {
        Self {
            page: Some(1),
            per_page: Some(20),
        }
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct PaginatedResponse<T> {
    pub items: Vec<T>,
    pub page: u64,
    pub per_page: u64,
    pub total: u64,
}

impl<T> PaginatedResponse<T> {
    pub fn new(items: Vec<T>, pagination: Pagination, total: u64) -> Self {
        Self {
            items,
            page: pagination.page,
            per_page: pagination.per_page,
            total,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct PublicUser {
    pub id: i64,
    pub email: String,
    pub role: PlatformRole,
    pub business_role: BusinessRole,
    pub agency_id: Option<i64>,
    pub is_verified: bool,
}

#[derive(Clone, Debug)]
pub struct UserRecord {
    pub id: i64,
    pub email: String,
    pub password_hash: String,
    pub role: PlatformRole,
    pub business_role: BusinessRole,
    pub phone: Option<String>,
    pub agency_id: Option<i64>,
    pub billing_account_id: Option<i64>,
    pub is_verified: bool,
}

impl UserRecord {
    pub fn public(&self) -> PublicUser {
        PublicUser {
            id: self.id,
            email: self.email.clone(),
            role: self.role,
            business_role: self.business_role,
            agency_id: self.agency_id,
            is_verified: self.is_verified,
        }
    }
}

pub fn parse_db_f64(raw: String, field: &str) -> Result<f64, ApiError> {
    raw.parse::<f64>().map_err(|_| {
        ApiError::internal(
            "invalid_numeric_value",
            format!("Stored value for {field} is not a valid number"),
        )
    })
}

pub fn parse_optional_db_f64(raw: Option<String>, field: &str) -> Result<Option<f64>, ApiError> {
    raw.map(|value| parse_db_f64(value, field)).transpose()
}

pub fn slugify(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut last_dash = false;

    for mapped in input.chars().flat_map(normalize_char) {
        if mapped.is_ascii_alphanumeric() {
            out.push(mapped.to_ascii_lowercase());
            last_dash = false;
        } else if !last_dash && !out.is_empty() {
            out.push('-');
            last_dash = true;
        }
    }

    while out.ends_with('-') {
        out.pop();
    }

    if out.is_empty() {
        "listing".to_string()
    } else {
        out
    }
}

fn normalize_char(ch: char) -> Vec<char> {
    match ch {
        'ą' | 'Ą' => vec!['a'],
        'ć' | 'Ć' => vec!['c'],
        'ę' | 'Ę' => vec!['e'],
        'ł' | 'Ł' => vec!['l'],
        'ń' | 'Ń' => vec!['n'],
        'ó' | 'Ó' => vec!['o'],
        'ś' | 'Ś' => vec!['s'],
        'ż' | 'Ż' | 'ź' | 'Ź' => vec!['z'],
        other => vec![other],
    }
}

#[cfg(test)]
mod tests {
    use super::slugify;

    #[test]
    fn slugify_handles_polish_characters() {
        assert_eq!(slugify("Dom Łódź Śródmieście"), "dom-lodz-srodmiescie");
    }
}
