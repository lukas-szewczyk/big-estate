# ==========================================
# Hetzner Cloud — Serwer produkcyjny
# ==========================================
resource "hcloud_server" "moj_serwer" {
  name        = "produkcja-serwer-01"
  image       = "ubuntu-24.04"
  server_type = "cpx22"
  location    = "nbg1"
}
