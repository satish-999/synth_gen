# Start SynthGen for LAN access (no Cloudflare, works offline on same Wi-Fi)
# Usage: .\server\scripts\start-lan.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$serverDir = Join-Path $root "server"
$dist = Join-Path $root "client\dist"

if (-not (Test-Path $dist)) {
  Write-Host "Building client..." -ForegroundColor Yellow
  Push-Location (Join-Path $root "client")
  npm run build
  Pop-Location
}

$env:HOST = "0.0.0.0"
if (-not $env:PORT) { $env:PORT = "3000" }

$ip = (Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.InterfaceAlias -notmatch "Loopback" -and $_.IPAddress -notmatch "^169" } |
  Select-Object -First 1).IPAddress

Write-Host ""
Write-Host "SynthGen LAN mode" -ForegroundColor Cyan
Write-Host "  This PC:     http://localhost:$($env:PORT)"
if ($ip) {
  Write-Host "  Same Wi-Fi:  http://${ip}:$($env:PORT)" -ForegroundColor Green
}
Write-Host ""
Write-Host "No internet required. Other devices must be on the same network." -ForegroundColor DarkGray
Write-Host "For a public internet link, use cloudflared in a second terminal (see DEPLOYMENT.md)." -ForegroundColor DarkGray
Write-Host ""

Push-Location $serverDir
npm start
