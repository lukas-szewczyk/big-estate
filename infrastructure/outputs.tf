# ==========================================
# Outputy
# ==========================================

# Hetzner
output "serwer_ip" {
  description = "IP serwera w Hetzner Cloud (ukryte za Cloudflare proxy)"
  value       = hcloud_server.moj_serwer.ipv4_address
  sensitive   = true
}

# Cloudflare
output "front_worker_domain" {
  description = "Domena pod którą działa Worker front"
  value       = cloudflare_workers_custom_domain.front.hostname
}

output "dns_serwer_hetzner" {
  description = "DNS rekord wskazujący na serwer Hetzner"
  value       = "${cloudflare_dns_record.serwer_hetzner.name}.${var.domain}"
}
