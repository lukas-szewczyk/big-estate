use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum UserRole {
    Admin,
    User,
}

impl UserRole {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Admin => "admin",
            Self::User => "user",
        }
    }
}

impl TryFrom<&str> for UserRole {
    type Error = String;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "admin" => Ok(Self::Admin),
            "user" => Ok(Self::User),
            other => Err(format!("unknown role {other}")),
        }
    }
}

impl TryFrom<String> for UserRole {
    type Error = String;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::try_from(value.as_str())
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct PublicUser {
    pub id: i64,
    pub email: String,
    pub role: UserRole,
}

#[derive(Clone, Debug)]
pub struct UserRecord {
    pub id: i64,
    pub email: String,
    pub password_hash: String,
    pub role: UserRole,
}

impl UserRecord {
    pub fn public(&self) -> PublicUser {
        PublicUser {
            id: self.id,
            email: self.email.clone(),
            role: self.role,
        }
    }
}
