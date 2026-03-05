# ==========================================
# Infrastruktura — God Project
# ==========================================
#
# Struktura plików:
#   versions.tf    — Wersje Terraform i providerów
#   variables.tf   — Zmienne wejściowe
#   providers.tf   — Konfiguracja providerów (Hetzner, Cloudflare)
#   hetzner.tf     — Zasoby Hetzner Cloud (serwer)
#   cloudflare.tf  — Zasoby Cloudflare (DNS, Workers domain, ustawienia strefy)
#   outputs.tf     — Wartości wyjściowe
#
# Użycie:
#   1. cp terraform.tfvars.example terraform.tfvars
#   2. Wypełnij terraform.tfvars swoimi danymi
#   3. export CLOUDFLARE_API_TOKEN="twój-token"
#   4. terraform init
#   5. terraform plan
#   6. terraform apply
#
# Deployment Workera (apps/front):
#   Kod Workera deployujemy przez Wrangler (nie Terraform):
#   cd apps/front && pnpm deploy
# ==========================================
