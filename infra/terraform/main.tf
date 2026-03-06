locals {
  default_labels = {
    app        = "server-axum"
    managed_by = "terraform"
  }
}

resource "hcloud_ssh_key" "this" {
  name       = "${var.server_name}-key"
  public_key = trimspace(var.ssh_public_key)
}

resource "hcloud_firewall" "this" {
  name = "${var.server_name}-firewall"

  rule {
    direction  = "in"
    port       = "22"
    protocol   = "tcp"
    source_ips = var.allowed_ssh_cidrs
  }

  rule {
    direction  = "in"
    port       = "80"
    protocol   = "tcp"
    source_ips = ["0.0.0.0/0", "::/0"]
  }
}

resource "hcloud_server" "this" {
  name         = var.server_name
  server_type  = var.server_type
  image        = var.server_image
  location     = var.location
  ssh_keys     = [hcloud_ssh_key.this.id]
  firewall_ids = [hcloud_firewall.this.id]
  user_data = templatefile("${path.module}/cloud-init.yaml.tftpl", {
    ssh_public_key = trimspace(var.ssh_public_key)
  })

  labels = merge(local.default_labels, var.labels)
}
