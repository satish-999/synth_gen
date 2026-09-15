#!/bin/bash
# Run interactively through AWS Session Manager, after BUILD_READY exists.
set -euo pipefail
cd /opt/synthgen
[[ -f BUILD_READY ]] || { echo 'Image build is not finished.'; exit 1; }
[[ ! -e .env ]] || { echo '.env already exists; preserve it and review changes manually.'; exit 1; }
read -r -p 'Public DNS hostname (no https://): ' domain
[[ "$domain" =~ ^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$ && "$domain" == *.* ]] || { echo 'Invalid hostname.'; exit 1; }
read -r -p 'SynthGen login username: ' login
[[ "$login" =~ ^[a-zA-Z0-9_-]{3,40}$ ]] || { echo 'Use 3-40 letters, digits, underscore or hyphen.'; exit 1; }
read -r -s -p 'Unique password (20-128 letters, digits, underscore or hyphen): ' pass
printf '\n'
[[ "$pass" =~ ^[a-zA-Z0-9_-]{20,128}$ ]] || { echo 'Password does not meet the required format.'; exit 1; }
read -r -s -p 'Confirm password: ' confirm
printf '\n'
[[ "$pass" == "$confirm" ]] || { echo 'Passwords do not match.'; exit 1; }
umask 077
printf 'SYNTHGEN_DOMAIN=%s\nBASIC_AUTH_USER=%s\nBASIC_AUTH_PASS=%s\n' "$domain" "$login" "$pass" > .env
unset pass confirm
docker compose -f docker-compose.yml -f compose.https.yml -f deploy/aws/compose.pilot.yml up -d --no-build
printf 'Starting SynthGen at https://%s. Verify certificate and login before use.\n' "$domain"