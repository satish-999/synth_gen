# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# SynthGen container
#
# Fixes against the previous image:
#   - the Python engine source was never copied (only requirements.txt), so
#     synthgen.py / validate_compliance.py / normalize_model.py did not exist
#     inside the container and every generation would fail
#   - `npm ci --omit=dev` dropped tsx, then `npx tsx` tried to download it from
#     the network at container start
#   - client/dist had to be pre-built on the host; it is now built from source
#   - runs as a non-root user, has a healthcheck, and data lives on a volume
# ---------------------------------------------------------------------------

# ---------- stage 1: build the front end from source ------------------------
FROM node:22-bookworm-slim AS client-build
WORKDIR /build
COPY client/package.json client/package-lock.json* ./
RUN npm ci
COPY client/ ./
RUN npm run build          # produces /build/dist

# ---------- stage 2: install server dependencies ----------------------------
FROM node:22-bookworm-slim AS server-deps
WORKDIR /build
COPY server/package.json server/package-lock.json* ./
# full install (not --omit=dev): tsx is the runtime launcher and must be present
# in the image rather than fetched at startup
RUN npm ci

# ---------- stage 3: runtime ------------------------------------------------
FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 python3-venv python3-pip curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python engine: dependencies first so the layer caches, then the source
COPY engine/requirements.txt ./engine/requirements.txt
RUN python3 -m venv /app/engine/.venv \
    && /app/engine/.venv/bin/pip install --no-cache-dir --upgrade pip \
    && /app/engine/.venv/bin/pip install --no-cache-dir -r engine/requirements.txt

# THE ENGINE SOURCE ITSELF — this is what the previous image was missing
COPY engine/ ./engine/

# server dependencies from the deps stage, then server source
COPY --from=server-deps /build/node_modules ./server/node_modules
COPY server/package.json server/package-lock.json* ./server/
COPY server/src/ ./server/src/
COPY server/tsconfig.json ./server/

# front end built in stage 1
COPY --from=client-build /build/dist ./client/dist

COPY docs/ ./docs/

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3080 \
    ENGINE_DIR=/app/engine \
    REGISTRY_PATH=/app/data/registry \
    RUNS_PATH=/app/data/runs \
    UPLOADS_PATH=/app/data/uploads \
    DRAFTS_PATH=/app/data/uploads/drafts \
    PYTHON_PATH=/app/engine/.venv/bin/python \
    PYTHON_TIMEOUT_MS=900000 \
    PYTHON_MAX_OUTPUT_BYTES=5242880

# data directories, owned by the unprivileged node user that ships with the image
RUN mkdir -p /app/data/registry /app/data/runs /app/data/uploads/drafts \
    && chown -R node:node /app/data

# fail fast if the engine did not make it into the image
RUN test -f /app/engine/synthgen.py \
    && test -f /app/engine/validate_compliance.py \
    && /app/engine/.venv/bin/python -c "import pandas, numpy, faker, openpyxl, yaml" \
    && echo "engine present and importable"

USER node
EXPOSE 3080
VOLUME ["/app/data"]

# /api/health is deliberately unauthenticated (see index.ts) so this works
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/api/health" || exit 1

WORKDIR /app/server
# call the local binary directly: deterministic, and never resolves over the network
CMD ["./node_modules/.bin/tsx", "src/index.ts"]
