# GCP deployment runbook

Status: local build tested; no GCP resources created by this runbook.
Target project to verify: project-3d511f28-91f1-48f5-97c.

Use one Compute Engine Linux VM for the initial trusted-user pilot. The current
SQLite database, model registry and generated parent CSV files need persistent
storage. Preserve the Docker synthgen-data volume across releases; replacing
it would lose the old records needed for incremental generation.

## Proposed resources, pending region and cost confirmation

- One e2-medium VM (4 GiB RAM), Debian 12, with 30 GiB balanced persistent boot disk.
- A dedicated VPC/subnet and firewall scoped to this VM. HTTPS for pilot users;
  administrative SSH via IAP, with no unrestricted public SSH rule.
- One external IP and HTTPS reverse proxy. Configure the final hostname and TLS
  before giving users credentials. Keep application port 3080 on loopback.
- No managed database, Kubernetes cluster, load balancer or GPU is needed for
  this first pilot. Apply pilot resource labels for billing visibility.

Estimate the selected region using current Google pricing. As a US-region
reference, e2-medium is about USD 24.46 per 730-hour month; one in-use external
IPv4 is about USD 3.65. Add disk, backups and outbound traffic. A USD 35-50/month
planning allowance for light use is an estimate, not a quote or spending cap.
India pricing must be checked separately before provisioning.

The eligible-new-customer trial provides USD 300 for up to 90 days. A small pilot
should fit within that credit under light use, assuming other project workloads
do not consume it. Check actual remaining credits and trial expiry in Billing.
Budget alerts warn about spend; they do not automatically stop resources.
Direct Anthropic API calls are billed separately from Google Cloud.

## Preflight (read-only)

```powershell
gcloud auth login
gcloud projects describe project-3d511f28-91f1-48f5-97c
gcloud billing projects describe project-3d511f28-91f1-48f5-97c
```

After confirming the final resource estimate, provision the VM and install Docker
and its Compose plugin using the official Debian installation instructions.
Upload the current local source release, not the older GitHub checkout. Create a
private .env containing BASIC_AUTH_USER, BASIC_AUTH_PASS and PUBLIC_URL, then run
`docker compose up -d --build`. Configure the HTTPS reverse proxy to forward to
127.0.0.1:3080. Never put credentials in VM startup metadata or source control.

## Verification before inviting users

Follow the release checks in DEPLOYMENT.md, including an actual container build,
HTTPS/authentication, create-model and two-table incremental generation, downloads,
restart persistence, and backup/restore. Also verify access from another network.
The current pilot shares one workspace; it is not an isolated multi-customer SaaS.

Sources:
- https://cloud.google.com/signup-faqs
- https://cloud.google.com/products/compute/pricing/general-purpose
- https://cloud.google.com/vpc/pricing
- https://cloud.google.com/compute/disks-image-pricing