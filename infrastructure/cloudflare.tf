# ==========================================
# Cloudflare — Zarządzanie infrastrukturą dla apps/front
# ==========================================
#
# Wdrożenie samego kodu Workera odbywa się przez `wrangler deploy`
# (apps/front/package.json → "deploy": "wrangler deploy").
#
# Terraform zarządza infrastrukturą wokół Workera:
# - DNS, custom domains, ustawienia strefy
# ==========================================

# ------------------------------------------
# DNS: Rekord A dla serwera Hetzner
# ------------------------------------------
resource "cloudflare_dns_record" "serwer_hetzner" {
  zone_id = var.cf_zone_id
  name    = "app"
  content = hcloud_server.moj_serwer.ipv4_address
  type    = "A"
  proxied = true
  ttl     = 1
}

# ------------------------------------------
# Workers: Custom domain dla front
# ------------------------------------------
# Podpina Worker "front" (z wrangler.json) pod domenę
resource "cloudflare_workers_custom_domain" "front" {
  account_id = var.cf_account_id
  zone_id    = var.cf_zone_id
  hostname   = var.domain
  service    = "front"
}

# ------------------------------------------
# Ustawienia strefy (Zone Settings)
# ------------------------------------------

# SSL/TLS: Tryb Full (Strict) — szyfrowanie end-to-end
resource "cloudflare_zone_setting" "ssl" {
  zone_id    = var.cf_zone_id
  setting_id = "ssl"
  value      = "strict"
}

# Wymuszanie HTTPS — automatyczne przekierowanie HTTP → HTTPS
resource "cloudflare_zone_setting" "always_use_https" {
  zone_id    = var.cf_zone_id
  setting_id = "always_use_https"
  value      = "on"
}

# Minimalna wersja TLS — 1.2
resource "cloudflare_zone_setting" "min_tls_version" {
  zone_id    = var.cf_zone_id
  setting_id = "min_tls_version"
  value      = "1.2"
}

# Brotli compression
resource "cloudflare_zone_setting" "brotli" {
  zone_id    = var.cf_zone_id
  setting_id = "brotli"
  value      = "on"
}

# HTTP/2
resource "cloudflare_zone_setting" "http2" {
  zone_id    = var.cf_zone_id
  setting_id = "http2"
  value      = "on"
}

# HTTP/3 (QUIC)
resource "cloudflare_zone_setting" "http3" {
  zone_id    = var.cf_zone_id
  setting_id = "http3"
  value      = "on"
}

# Browser Integrity Check
resource "cloudflare_zone_setting" "browser_check" {
  zone_id    = var.cf_zone_id
  setting_id = "browser_check"
  value      = "on"
}

# Security level
resource "cloudflare_zone_setting" "security_level" {
  zone_id    = var.cf_zone_id
  setting_id = "security_level"
  value      = "medium"
}
