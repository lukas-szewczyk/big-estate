# ==========================================
# Wersje Terraform i providerów
# ==========================================
terraform {
  required_version = "~> 1.14"

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
