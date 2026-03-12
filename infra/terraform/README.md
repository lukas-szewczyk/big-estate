# Hetzner VPS for `apps/server-axum`

To keep the setup simple, Terraform is applied locally and GitHub Actions handles the app build and deploy.

## What gets created

- one Hetzner Cloud server (`cpx22` by default)
- one SSH key in Hetzner
- one firewall with inbound access for `22` and `80`
- cloud-init bootstrap that installs Docker and creates a `deploy` user

The server location is optional by default. If one region is temporarily unavailable for `cpx22`, Terraform can let Hetzner place the server in any available location.

## Local Terraform workflow

```sh
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars
terraform init
terraform apply
```

After `terraform apply`, note the `server_ipv4` output. That IP is used by the deploy workflow.
Wait until cloud-init finishes installing Docker before the first deploy. On a fresh server this usually takes about a minute.

## GitHub repository configuration

Repository variables:

- `VPS_HOST`: value from `terraform output -raw server_ipv4`
- `VPS_USER`: `deploy`

Repository secrets:

- `VPS_SSH_KEY`: private key matching `ssh_public_key`
- `GHCR_USERNAME`: GitHub username that owns the package token
- `GHCR_PAT`: GitHub personal access token with package read access
- `SERVER_ENV_FILE`: full `.env` contents passed to the container during deploy

## Deploy flow

1. Push changes to `main` touching `apps/server-axum/**`.
2. GitHub Actions runs `cargo fmt --check`, `cargo clippy`, `cargo test`, then builds the Docker image from `apps/server-axum/Dockerfile` and pushes it to GHCR.
3. The workflow connects to the Hetzner server over SSH, writes `/opt/server-axum/.env` from `SERVER_ENV_FILE`, pulls the new image, and restarts the container.
4. The deploy finishes only after the container reports a healthy `/health` endpoint.
