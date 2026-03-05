# ==========================================
# Zmienne globalne
# ==========================================
variable "domain" {
  description = "Główna domena (np. example.com)"
  type        = string
}

# ==========================================
# Hetzner Cloud
# ==========================================
variable "hcloud_token" {
  description = "Token API do Hetzner Cloud"
  type        = string
  sensitive   = true
}

# ==========================================
# Cloudflare
# ==========================================
variable "cf_account_id" {
  description = "Account ID Cloudflare (Dashboard → Workers & Pages → prawą stroną)"
  type        = string
}

variable "cf_zone_id" {
  description = "Zone ID domeny w Cloudflare (Dashboard → strona domeny → prawą stroną)"
  type        = string
}
