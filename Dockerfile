FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python engine
COPY engine/requirements.txt engine/requirements.txt
RUN python3 -m venv /app/engine/.venv \
    && /app/engine/.venv/bin/pip install --no-cache-dir -r engine/requirements.txt

# Node server
COPY server/package.json server/package-lock.json* ./server/
RUN cd server && npm ci --omit=dev

COPY server/ ./server/
COPY client/dist/ ./client/dist/
COPY docs/ ./docs/

ENV HOST=0.0.0.0
ENV PORT=3080
ENV ENGINE_DIR=/app/engine
ENV REGISTRY_PATH=/app/data/registry
ENV RUNS_PATH=/app/data/runs
ENV UPLOADS_PATH=/app/data/uploads
ENV DRAFTS_PATH=/app/data/uploads/drafts
ENV PYTHON_PATH=/app/engine/.venv/bin/python

RUN mkdir -p /app/data/registry /app/data/runs /app/data/uploads

EXPOSE 3080
VOLUME ["/app/data"]

WORKDIR /app/server
CMD ["npx", "tsx", "src/index.ts"]
