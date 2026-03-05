# ==========================================
# Konfiguracja providerów
# ==========================================

# Hetzner Cloud — token z TF_VAR_hcloud_token
provider "hcloud" {
  token = var.hcloud_token
}

# Cloudflare — token ze zmiennej środowiskowej CLOUDFLARE_API_TOKEN
provider "cloudflare" {}
