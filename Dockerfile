# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# SynthGen container
#
# Fixes against the previous image:
#   - the Python engine source was never copied (only requirements.txt), so
#     synthgen.py / validate_compliance.py / normalize_model.py did not exist
#     inside the container and every generation would fail
#   - server is compiled ahead of time (tsc -> dist/) and run with plain
#     `node`, instead of transpiling with tsx at container start
#   - client/dist had to be pre-built on the host; it is now built from source
#   - runs as a non-root user, has a healthcheck, and data lives on a volume
# ---------------------------------------------------------------------------

# ---------- stage 1: build server + client from source -----------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY server/package*.json ./server/
COPY client/package*.json ./client/
RUN cd server && npm ci && cd ../client && npm ci
COPY server/ ./server/
COPY client/ ./client/
RUN cd server && npx tsc && cd ../client && npm run build
RUN cd server && npm prune --omit=dev

# ---------- stage 2: runtime ------------------------------------------------
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

# compiled server + its production node_modules from the build stage
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/server/node_modules ./server/node_modules
COPY --from=build /app/server/dist ./server/dist

# front end built in the same stage
COPY --from=build /app/client/dist ./client/dist

COPY docs/ ./docs/
COPY templates/ ./templates/

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
CMD ["node", "dist/index.js"]
