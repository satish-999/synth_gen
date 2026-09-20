# Deploying SynthGen on AWS

Target shape: **one small EC2 instance** running your container behind an HTTPS
reverse proxy, with a separate data volume that survives instance replacement.
This is the right pilot architecture — simple, cheap, and everything stays on a
machine you control.

Estimated cost: **$15–25/month** (t3.small + 20 GB storage + elastic IP). Your
$100 credits cover several months.

---

## Before you start

| Check | Why |
|---|---|
| AWS account verification complete | Account 0385 showed "verification in progress" — you cannot launch instances until it clears. Check the console; contact AWS Support if past 48h |
| Repository pushed to GitHub | `satish-999/synth_gen` — already done |
| Decide the password | Not `demo/test123`. Generate a strong one and keep it in a password manager |
| Decide a region | `ap-south-1` (Mumbai) is closest to you — lower latency than Stockholm |

**Do not skip:** if account 9590 still has the earlier SynthGen server, inspect
it first (per your handoff) rather than building a duplicate.

---

## Step 1 — Launch the instance

Console → EC2 → **Launch instance**

| Setting | Value |
|---|---|
| Name | `synthgen-pilot` |
| AMI | **Ubuntu Server 24.04 LTS** |
| Instance type | **t3.small** (2 GB RAM — t2.micro's 1 GB is too small for pandas and the image build) |
| Key pair | Proceed **without** a key pair — you will use Session Manager instead of SSH |
| Storage | 20 GB gp3, **encrypted** |

**Network settings → Edit:**
- Allow **HTTPS (443)** from `0.0.0.0/0`
- Allow **HTTP (80)** from `0.0.0.0/0` — needed for certificate issuance
- **Do NOT open 22 (SSH) or 3080.** The app port stays private; admin access
  comes through Session Manager

**Advanced details → IAM instance profile:** create a role with the
`AmazonSSMManagedInstanceCore` policy attached and select it. Without this you
cannot connect to the instance at all.

Launch, then **Elastic IP → Allocate → Associate** with the instance, so the
address survives restarts.

---

## Step 2 — Connect

EC2 → select instance → **Connect** → **Session Manager** tab → Connect.

A browser shell opens. No SSH key, no open port 22.

```bash
sudo su - ubuntu
```

---

## Step 3 — Install Docker

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
| sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo usermod -aG docker $USER
newgrp docker
docker --version
```

---

## Step 4 — Get the source and build

```bash
cd /opt
sudo mkdir -p synthgen && sudo chown $USER:$USER synthgen
cd synthgen
git clone https://github.com/satish-999/synth_gen.git .
docker build -t synthgen:latest .
```

Watch for `engine present and importable` — that assertion proves the Python
engine is inside the image. The build takes 5–10 minutes on a t3.small.

If the build runs out of memory, add swap and retry:

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

---

## Step 5 — Configuration and data

```bash
mkdir -p /opt/synthgen/data
sudo chown -R 1000:1000 /opt/synthgen/data     # the container runs as uid 1000 (node)

cat > /opt/synthgen/.env <<'EOF'
NODE_ENV=production
HOST=0.0.0.0
PORT=3080
BASIC_AUTH_USER=synthgen
BASIC_AUTH_PASS=CHANGE_THIS_TO_A_STRONG_PASSWORD
ANTHROPIC_API_KEY=your-key-here
PUBLIC_URL=https://synthgen.<your-elastic-ip>.sslip.io
CORS_ORIGINS=https://synthgen.<your-elastic-ip>.sslip.io
PYTHON_TIMEOUT_MS=900000
PYTHON_MAX_OUTPUT_BYTES=5242880
EOF

chmod 600 /opt/synthgen/.env
```

`sslip.io` resolves `anything.<ip>.sslip.io` to that IP, so you get a working
hostname for certificates without buying a domain. Replace dots in the IP with
dashes: `13-48-177-171`. Use a real domain when you have one.

---

## Step 6 — HTTPS with Caddy

Caddy obtains and renews certificates automatically.

```bash
cat > /opt/synthgen/compose.yml <<'EOF'
services:
  app:
    image: synthgen:latest
    restart: unless-stopped
    env_file: /opt/synthgen/.env
    volumes:
      - /opt/synthgen/data:/app/data
    expose:
      - "3080"                      # private to the compose network, not the host
    mem_limit: 1500m
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://127.0.0.1:3080/api/health"]
      interval: 30s
      timeout: 5s
      retries: 3

  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /opt/synthgen/Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      - app

volumes:
  caddy_data:
  caddy_config:
EOF

cat > /opt/synthgen/Caddyfile <<'EOF'
synthgen.<your-elastic-ip-with-dashes>.sslip.io {
    reverse_proxy app:3080
    request_body {
        max_size 50MB
    }
}
EOF
```

Edit the hostname in both files to match your elastic IP, then start:

```bash
cd /opt/synthgen
docker compose up -d
docker compose logs -f
```

Wait for Caddy to report a certificate, and the app to log
`SynthGen server listening`.

---

## Step 7 — Verify

From your laptop, not the server:

```powershell
curl.exe -i https://synthgen.<your-ip>.sslip.io/api/health          # 200, no auth
curl.exe -i https://synthgen.<your-ip>.sslip.io/api/status          # 401
curl.exe -i -u synthgen:<password> https://synthgen.<your-ip>.sslip.io/api/status   # 200
```

Then in a browser: sign in, register a model, generate data, download a CSV.

**Reboot test** — the one people skip:

```bash
sudo reboot
```

Wait two minutes, then reload the URL. Models and run history must still be
there. If they are not, the volume mount is wrong.

---

## Step 8 — Operational essentials

**Backups** (run daily via cron):

```bash
cat > /opt/synthgen/backup.sh <<'EOF'
#!/bin/bash
ts=$(date +%Y%m%d)
tar czf /tmp/synthgen-$ts.tar.gz -C /opt/synthgen data
aws s3 cp /tmp/synthgen-$ts.tar.gz s3://<your-bucket>/backups/
rm /tmp/synthgen-$ts.tar.gz
EOF
chmod +x /opt/synthgen/backup.sh
(crontab -l 2>/dev/null; echo "0 2 * * * /opt/synthgen/backup.sh") | crontab -
```

This needs `aws` CLI installed and S3 write permission added to the instance
role. **Restore-test it once** — an untested backup is not a backup.

**Retention** — runs accumulate forever otherwise:

```bash
(crontab -l; echo "0 3 * * * find /opt/synthgen/data/runs -maxdepth 1 -type d -mtime +30 -exec rm -rf {} +") | crontab -
```

**Billing alarm:** Billing → Budgets → create a $20/month alert. Do this on day
one, not after a surprise.

**Updating after a code change:**

```bash
cd /opt/synthgen
git pull
docker build -t synthgen:latest .
docker compose up -d
```

---

## Step 9 — Before sharing the link widely

Re-read §"What deployment does not give you": one shared login, no per-user
isolation, one generation at a time, no request limits. For your own team that
is an acceptable pilot. Before anyone outside it uses this:

- [ ] Strong password, rotated when people leave
- [ ] Row-count and concurrency limits enforced server-side
- [ ] Backup restore tested in isolation
- [ ] Retention policy active
- [ ] Billing alarm live
- [ ] Someone named as owner for when it breaks

---

## If the account is still blocked

Everything up to Step 4 can be prepared offline. If verification has not cleared
and you need a link this week, Render's free tier (see `FREE_HOSTING_GUIDE.md`)
deploys the same image from the same repository in about fifteen minutes, and
you can migrate to EC2 later — the container and data layout are identical.
