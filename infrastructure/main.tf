# ==========================================
# 1. KONFIGURACJA PROVIDERÓW
# ==========================================
terraform {
  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "~> 1.45"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }
}

# ==========================================
# 2. ZMIENNE
# ==========================================
variable "hcloud_token" {
  description = "Token API do Hetzner Cloud"
  type        = string
  sensitive   = true
}

variable "cf_zone_id" {
  description = "Zone ID Twojej domeny w Cloudflare"
  type        = string
  default     = "TUTAJ_WKLEJ_SWOJE_ZONE_ID"
}

# Provider Hetzner (wymaga podania zmiennej)
provider "hcloud" {
  token = var.hcloud_token
}

# Provider Cloudflare (token pobiera automatycznie ze zmiennej środowiskowej CLOUDFLARE_API_TOKEN)
provider "cloudflare" {}

# ==========================================
# 3. ZASÓB: SERWER W HETZNERZE
# ==========================================
resource "hcloud_server" "moj_serwer" {
  name        = "produkcja-serwer-01"
  image       = "ubuntu-24.04"
  server_type = "cpx22"
  location    = "nbg1"
}

# ==========================================
# 4. ZASÓB: REKORD DNS W CLOUDFLARE
# ==========================================
resource "cloudflare_dns_record" "domena_serwera" {
  zone_id = var.cf_zone_id
  name    = "app"
  content = hcloud_server.moj_serwer.ipv4_address
  type    = "A"
  proxied = true # Ukrywa prawdziwe IP serwera za chmurą Cloudflare
  ttl     = 1
}

# ==========================================
# 5. PODSUMOWANIE (OUTPUT)
# ==========================================
output "adres_strony" {
  value       = "Serwer podpięty pod: ${cloudflare_dns_record.domena_serwera.name}.twojadomena.pl"
  description = "Informacja końcowa"
}

output "ukryte_ip_serwera" {
  value       = hcloud_server.moj_serwer.ipv4_address
  description = "Prawdziwe IP w Hetznerze (zabezpieczone przez Cloudflare)"
}
