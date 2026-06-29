# Threat Model

## Project Overview

TextGlide is a public web application that accepts user-supplied plain text and DRM-free EPUB uploads, inserts phrase-boundary spacing, and returns either preview text or a transformed EPUB for download. The production deployment is a Fly.io-hosted Flask application in `artifacts/api-server/app.py` that serves a built React frontend from `artifacts/epub-injector/dist/public`; the TypeScript Express server under `artifacts/api-server/src` is presently a development scaffold, not the production entry point.

Production assumptions for security review:
- Production traffic is protected in transit by platform TLS.
- The Fly.io app is intended to be publicly reachable from the internet.
- `NODE_ENV=production` applies to the frontend build path, but the primary production server is Python/Flask.
- The mockup sandbox artifact is dev-only and should be ignored unless a production route or build step exposes it.

## Assets

- **Uploaded EPUB content** — user-provided books may contain private or copyrighted content. The service must avoid exposing uploaded files to other users and must not let malicious EPUB structure compromise server availability.
- **Service availability and compute budget** — EPUB parsing and spaCy processing are CPU- and memory-intensive. Abuse of public processing endpoints can exhaust the single-worker production service.
- **Application secrets** — `ALTCHA_HMAC_KEY` and deployment credentials must not be exposed through responses, logs, or client bundles.
- **Static site integrity** — the React frontend served from Flask must not become a path to script injection or unsafe file exposure.

## Trust Boundaries

- **Browser to Flask API** — `/api/preview`, `/api/process`, and `/api/altcha` accept untrusted user input and file uploads from the public internet.
- **Flask to EPUB/HTML/XML parsers** — untrusted archive contents cross into `zipfile`, BeautifulSoup, and spaCy processing in `artifacts/api-server/epub_processor.py`.
- **Flask to local filesystem** — uploads are written to temporary directories and transformed server-side before being returned.
- **Build-time frontend to production server** — the frontend is bundled separately and then served statically by Flask; dev-only Vite and mockup tooling should not affect production.

## Scan Anchors

- **Production entry points:** `Dockerfile`, `fly.toml`, `artifacts/api-server/app.py`, `artifacts/api-server/epub_processor.py`
- **Highest-risk area:** public EPUB upload and archive parsing in `/api/process`
- **Public surfaces:** `GET /api/altcha`, `GET /api/healthz`, `POST /api/preview`, `POST /api/process`, static frontend routes
- **Dev-only areas usually out of scope:** `artifacts/mockup-sandbox/**`, `artifacts/api-server/src/**` Express scaffold, `scripts/**`, currently-unused `lib/db/**`

## Threat Categories

### Spoofing

This application has no user account system, so classic account impersonation is not the primary risk. The main authenticity guarantee is that expensive processing requests to `/api/process` should come from real clients that solved the ALTCHA challenge, and challenge validation must not be trivially bypassable or forgeable.

### Tampering

Uploaded EPUBs and request parameters are fully attacker-controlled. The server must strictly constrain accepted modes, languages, and file handling behavior, and must ensure archive contents cannot alter files outside the intended temporary workspace or change server behavior.

### Information Disclosure

The service processes potentially sensitive books and returns transformed output to the uploader. Uploaded content, filesystem data, secrets, and parser error details must not be exposed to other users, to the browser beyond the intended response, or to logs in a way that leaks private content.

### Denial of Service

This is the dominant threat category for the current architecture. A single public Flask/Gunicorn worker performs zip parsing, XML/HTML parsing, and NLP on attacker-supplied content. The system must enforce tight limits on request size, archive expansion, file counts, document counts, parsing workload, and request rate so a malicious EPUB or burst of requests cannot exhaust CPU, memory, or worker time.

### Elevation of Privilege

The public upload pipeline must not let attacker-controlled EPUB/XML content cross into code execution, filesystem escape, SSRF, or arbitrary server file access through parser behavior. The static file route must continue to enforce confinement to the intended frontend bundle.
