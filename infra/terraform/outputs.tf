output "app_url" {
  description = "HTTP endpoint for the deployed app."
  value       = "http://${hcloud_server.this.ipv4_address}"
}

output "server_id" {
  description = "Hetzner server ID."
  value       = hcloud_server.this.id
}

output "server_ipv4" {
  description = "Public IPv4 address of the server."
  value       = hcloud_server.this.ipv4_address
}

output "ssh_user" {
  description = "SSH user created for deployments."
  value       = "deploy"
}
