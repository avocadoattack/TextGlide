# ══════════════════════════════════════════════════════════════
#  Stage 1 — Build React frontend
# ══════════════════════════════════════════════════════════════
FROM node:20-slim AS frontend

WORKDIR /build

RUN npm install -g pnpm

# Workspace manifests (own layer — cached unless deps change)
COPY pnpm-workspace.yaml package.json tsconfig.json tsconfig.base.json pnpm-lock.yaml ./

# Shared TS libs + the frontend package
COPY lib/ ./lib/
COPY artifacts/epub-injector/ ./artifacts/epub-injector/

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @workspace/epub-injector run build
# Output: /build/artifacts/epub-injector/dist/public/


# ══════════════════════════════════════════════════════════════
#  Stage 2 — Python / Flask production image
# ══════════════════════════════════════════════════════════════
FROM python:3.11-slim AS app

WORKDIR /app

# Build tools required by some pip packages (lxml, etc.)
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
RUN pip install --no-cache-dir \
    "altcha>=2.0.0" \
    "beautifulsoup4>=4.15.0" \
    "ebooklib>=0.20" \
    "flask>=3.1.3" \
    "flask-limiter>=3.5.0" \
    "gunicorn>=21.2.0" \
    "lxml>=6.1.1" \
    "spacy>=3.8.14"

# Download spaCy language models
RUN python -m spacy download en_core_web_sm && \
    python -m spacy download es_core_news_sm

# Copy Flask application
COPY artifacts/api-server/app.py ./
COPY artifacts/api-server/epub_processor.py ./
COPY artifacts/api-server/textglide_config.py ./

# Copy built React app into Flask's static directory
COPY --from=frontend /build/artifacts/epub-injector/dist/public/ ./static/

# Run as non-root
RUN useradd -m -u 1000 textglide && chown -R textglide:textglide /app
USER textglide

ENV PORT=8080
EXPOSE 8080

# 1 worker: spaCy loads once, saves ~150 MB RAM
# 2 threads: handles concurrent lightweight requests
# 120s timeout: covers large EPUB processing
CMD ["gunicorn", \
     "--bind", "0.0.0.0:8080", \
     "--workers", "1", \
     "--threads", "2", \
     "--timeout", "120", \
     "app:app"]
