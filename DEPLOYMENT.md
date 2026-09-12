# SynthGen — Network Deployment Guide

Use this guide after Phases 1–8 are complete. Phase 9 makes SynthGen reachable from other machines and networks.

## Quick reference

| Scenario | Setup | Needs internet? |
|----------|--------|-----------------|
| **This PC only** | `npm start` → `http://localhost:3000` | No |
| **Same Wi‑Fi / LAN** | `HOST=0.0.0.0` → `http://<server-ip>:PORT` | No (same network only) |
| **Docker on one machine** | `docker compose up --build` | No |
| **Temporary public link** | Cloudflare quick tunnel (see §8) | Yes — PC on, tunnel running |
| **Internet (HTTPS, stable)** | Cloud VM or reverse proxy + domain (§4–5) | Yes |

---

## 8. Cloudflare quick tunnel (temporary public link)

A **quick tunnel** (`npx cloudflared tunnel --url http://127.0.0.1:3000`) gives a URL like `https://xxxx.trycloudflare.com` that works from any network. It is fine for **short demos**, not for production.

### Why the link stops working

| Cause | What happens |
|-------|----------------|
| **PC locked / sleeping** | Server and tunnel pause; link returns errors |
| **No internet** | Tunnel cannot reach Cloudflare; link fails |
| **Tunnel process closed** | Public URL dies; must start cloudflared again |
| **Server stopped** (`Ctrl+C`) | Nothing listens; tunnel has nothing to forward |
| **New tunnel session** | URL **changes** every time you restart cloudflared |

The Cloudflare link is **not** stored on your machine — it is a live bridge. When the bridge stops, the link stops.

### Reliable workflow for demos

**Terminal 1 — keep running (server):**
```powershell
cd C:\Users\hi\Projects\synthetic-data-gen\server
$env:HOST="127.0.0.1"
$env:PORT="3000"
npm start
```

**Terminal 2 — keep running (tunnel, only if you need internet access):**
```powershell
npx --yes cloudflared tunnel --url http://127.0.0.1:3000
```
Copy the new `https://….trycloudflare.com` URL from the output each time.

**On the PC:** disable sleep while demoing (Settings → Power → screen off OK, sleep **Never**).

### Better options by need

| Need | Use instead of Cloudflare |
|------|---------------------------|
| **Same office / Wi‑Fi, no internet** | LAN mode — §1 below (`HOST=0.0.0.0`) |
| **Only this computer, offline** | `http://localhost:3000` after `npm start` |
| **Stable link for weeks** | Deploy to a cloud VM (§5) with a fixed IP/domain |
| **Link survives PC restart** | VM + systemd/Docker auto-restart, not a laptop tunnel |

**SynthGen itself works fully offline** once the server is running — generation, validation, and downloads do not need the internet. Only the **Cloudflare tunnel** needs internet.

---

## 1. LAN access (same network)

On the machine running SynthGen:

```powershell
cd client
npm run build

cd ../server
$env:HOST="0.0.0.0"
$env:PORT="3080"
npm start
```

On another device on the same network, open:

```text
http://<SERVER_IP>:3080
```

Find the server IP:

```powershell
ipconfig
# Look for IPv4 Address on your active adapter
```

**Windows firewall:** allow inbound TCP on port 3080 (or your chosen PORT).

---

## 2. Environment variables

Copy `server/.env.production.example` to `server/.env.production`:

| Variable | Purpose |
|----------|---------|
| `HOST` | `127.0.0.1` = local only; `0.0.0.0` = all interfaces |
| `PORT` | HTTP port (default 3000; use 3080 if 3000 is taken) |
| `PUBLIC_URL` | Public base URL for health/logs |
| `BASIC_AUTH_USER` / `BASIC_AUTH_PASS` | Optional login before UI/API |
| `REGISTRY_PATH`, `RUNS_PATH`, `UPLOADS_PATH` | Persistent data dirs |

Load env on start (PowerShell):

```powershell
Get-Content server\.env.production | ForEach-Object {
  if ($_ -match '^([^#=]+)=(.*)$') { Set-Item -Path "env:$($matches[1])" -Value $matches[2] }
}
npm start
```

---

## 3. Docker

Build the UI first (Docker image expects `client/dist`):

```powershell
cd client && npm run build && cd ..
docker compose up --build -d
```

Open `http://localhost:3080`. Data persists in the `synthgen-data` volume.

Health check: `GET /api/health`

---

## 4. HTTPS reverse proxy (internet access)

Do **not** expose port 3080 directly to the public internet without TLS and auth.

### Caddy example (`Caddyfile`)

```caddy
synthgen.example.com {
    reverse_proxy localhost:3080
    basicauth {
        admin $2a$14$...   # caddy hash-password
    }
}
```

### nginx example

```nginx
server {
    listen 443 ssl;
    server_name synthgen.example.com;

    ssl_certificate     /etc/letsencrypt/live/synthgen.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/synthgen.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        client_max_body_size 20M;
    }
}
```

Set on the SynthGen server:

```env
HOST=127.0.0.1
PORT=3080
PUBLIC_URL=https://synthgen.example.com
```

---

## 5. Cloud VM (AWS / Azure / GCP)

1. Provision a Linux VM (Ubuntu 22.04+).
2. Install Node 22+, Python 3.11+.
3. Clone repo, build client, install server deps, install engine venv.
4. Set `HOST=0.0.0.0` or bind to `127.0.0.1` behind nginx.
5. Mount persistent disk for `registry/`, `runs/`, `uploads/`.
6. Use systemd or Docker for auto-restart.
7. Open firewall: 443 (HTTPS) only; block direct 3080 from internet if using proxy.

### systemd unit (example)

```ini
[Unit]
Description=SynthGen
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/synthgen/server
EnvironmentFile=/opt/synthgen/server/.env.production
ExecStart=/usr/bin/npx tsx src/index.ts
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

---

## 6. Security checklist

- [ ] Enable `BASIC_AUTH_USER` / `BASIC_AUTH_PASS` or proxy-level auth
- [ ] Use HTTPS for any untrusted network
- [ ] Do not commit `.env` files with API keys
- [ ] Restrict firewall to required ports
- [ ] Back up `registry/` and `runs/` regularly

---

## 7. Verify deployment

```bash
curl http://<host>:3080/api/health
curl -u user:pass http://<host>:3080/api/models   # if auth enabled
```

From a browser on another machine: create model → review → generate → download zip.

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `EADDRINUSE` | Another app uses the port; set `$env:PORT="3080"` |
| Can't reach from other PC | Set `HOST=0.0.0.0`, check firewall |
| Cloudflare link error / 502 | Restart `npm start` and cloudflared; URL changes each tunnel start |
| Link worked yesterday | Quick tunnels are temporary — start tunnel again and share **new** URL |
| PC locked / no internet | Use LAN URL (`http://<ip>:PORT`) or localhost; tunnel will not work offline |
| Python errors in Docker | Image uses `/app/engine/.venv/bin/python` |
| UI 404 | Run `cd client && npm run build` before Docker build |
