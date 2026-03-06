variable "hcloud_token" {
  description = "Hetzner Cloud API token."
  type        = string
  sensitive   = true
}

variable "ssh_public_key" {
  description = "Public SSH key that will be added to the server and deploy user."
  type        = string
}

variable "server_name" {
  description = "Name of the Hetzner server."
  type        = string
  default     = "server-axum"
}

variable "server_type" {
  description = "Hetzner Cloud server type."
  type        = string
  default     = "cpx22"
}

variable "server_image" {
  description = "Image used for the server."
  type        = string
  default     = "debian-12"
}

variable "location" {
  description = "Hetzner Cloud location for the server. Set to null to let Hetzner pick any available location."
  type        = string
  default     = null
  nullable    = true
}

variable "allowed_ssh_cidrs" {
  description = "CIDR ranges allowed to connect over SSH."
  type        = list(string)
  default     = ["0.0.0.0/0", "::/0"]
}

variable "labels" {
  description = "Additional labels applied to the Hetzner server."
  type        = map(string)
  default     = {}
}
