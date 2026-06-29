"""
TextGlide — Flask backend.

Routes:
  GET  /api/healthz    — liveness probe
  POST /api/preview    — preview spacing on a plain-text snippet (fast, no EPUB)
  POST /api/process    — upload EPUB, return processed EPUB
"""

import io
import os
import shutil
import tempfile
import traceback
from pathlib import Path

import altcha
import secrets as _secrets
from datetime import datetime, timezone, timedelta

from flask import Flask, jsonify, request, send_file, send_from_directory
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

from epub_processor import (
    detect_language,
    is_drm_protected,
    preview_text,
    process_epub,
)

ALTCHA_HMAC_KEY = os.environ.get('ALTCHA_HMAC_KEY', '')
if not ALTCHA_HMAC_KEY:
    ALTCHA_HMAC_KEY = _secrets.token_hex(32)
    print("WARNING: ALTCHA_HMAC_KEY not set in environment — using ephemeral key. Set this secret for production stability.")

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024  # 50 MB

limiter = Limiter(
    get_remote_address,
    app=app,
    default_limits=[],
    storage_uri="memory://",
)


@app.errorhandler(429)
def ratelimit_handler(e):
    return jsonify({"error": "Too many requests. Please wait before trying again."}), 429


# ---------------------------------------------------------------------------
# CORS
# ---------------------------------------------------------------------------

@app.after_request
def add_cors(response):
    origin = request.headers.get("Origin", "")
    response.headers["Access-Control-Allow-Origin"] = origin or "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    response.headers["Access-Control-Allow-Credentials"] = "true"
    return response


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_VALID_MODES = {"pseudosyntactic", "syntactic"}
_VALID_DENSITIES = {"balanced", "strong"}
_VALID_LANGS = {"auto", "en", "es"}


def _safe(value: str, allowed: set, default: str) -> str:
    v = (value or "").strip().lower()
    return v if v in allowed else default


# ---------------------------------------------------------------------------
# Healthz
# ---------------------------------------------------------------------------

@app.route("/api/altcha", methods=["GET"])
def altcha_challenge():
    options = altcha.ChallengeOptionsV1(
        hmac_key=ALTCHA_HMAC_KEY,
        max_number=100000,
        expires=datetime.now(timezone.utc) + timedelta(minutes=10)
    )
    challenge = altcha.create_challenge_v1(options)
    return jsonify({
        'algorithm': challenge.algorithm,
        'challenge': challenge.challenge,
        'maxnumber': challenge.max_number,
        'salt': challenge.salt,
        'signature': challenge.signature,
    })


@app.route("/api/healthz", methods=["GET", "OPTIONS"])
def healthz():
    if request.method == "OPTIONS":
        return "", 204
    return jsonify({"status": "ok"})


# ---------------------------------------------------------------------------
# /api/preview — plain-text spacing preview
# ---------------------------------------------------------------------------

@app.route("/api/preview", methods=["POST", "OPTIONS"])
@limiter.limit("60 per minute")
def preview():
    if request.method == "OPTIONS":
        return "", 204

    data = request.get_json(silent=True) or {}
    text = str(data.get("text", ""))[:2000]  # cap input
    mode = _safe(data.get("mode", "pseudosyntactic"), _VALID_MODES, "pseudosyntactic")
    chunk_density = _safe(data.get("chunk_density", "balanced"), _VALID_DENSITIES, "balanced")
    language = _safe(data.get("language", "auto"), _VALID_LANGS, "auto")

    if not text.strip():
        return jsonify({"result": "", "mode_used": mode})

    try:
        result, mode_used = preview_text(text, mode, chunk_density, language)
        return jsonify({"result": result, "mode_used": mode_used})
    except Exception:
        traceback.print_exc()
        return jsonify({"error": "Preview failed."}), 500


# ---------------------------------------------------------------------------
# /api/process — EPUB upload → processed EPUB download
# ---------------------------------------------------------------------------

@app.route("/api/process", methods=["POST", "OPTIONS"])
@limiter.limit("5 per hour")
def process():
    if request.method == "OPTIONS":
        return "", 204

    altcha_payload = request.form.get('altcha', '')
    if not altcha_payload:
        return jsonify({'error': 'Verification token missing. Please wait for the page to load fully and try again.'}), 403
    try:
        ok, err = altcha.verify_solution_v1(altcha_payload, ALTCHA_HMAC_KEY, check_expires=True)
        if not ok:
            return jsonify({'error': 'Verification failed. Please refresh and try again.'}), 403
    except Exception:
        return jsonify({'error': 'Verification error. Please refresh and try again.'}), 403

    if "file" not in request.files:
        return jsonify({"error": "No file uploaded."}), 400

    file = request.files["file"]
    if not file.filename:
        return jsonify({"error": "Empty filename."}), 400
    if not file.filename.lower().endswith(".epub"):
        return jsonify({"error": "Please upload an EPUB file (.epub)."}), 400

    mode = _safe(request.form.get("mode", "pseudosyntactic"), _VALID_MODES, "pseudosyntactic")
    chunk_density = _safe(request.form.get("chunk_density", "balanced"), _VALID_DENSITIES, "balanced")
    language = _safe(request.form.get("language", "auto"), _VALID_LANGS, "auto")

    tmp_dir = tempfile.mkdtemp(prefix="textglide_")
    try:
        input_path = os.path.join(tmp_dir, "input.epub")
        file.save(input_path)

        # DRM check
        try:
            if is_drm_protected(input_path):
                return jsonify({
                    "error": (
                        "This EPUB is DRM-protected. TextGlide only works with "
                        "DRM-free books. Please use a DRM-free copy."
                    )
                }), 422
        except Exception:
            return jsonify({"error": "Could not read the EPUB. Please check it is a valid, unencrypted EPUB file."}), 400

        try:
            epub_bytes, mode_used = process_epub(
                input_path, mode, chunk_density, language
            )
        except Exception:
            traceback.print_exc()
            return jsonify({"error": "Processing failed. The file may be malformed."}), 500

        stem = Path(file.filename).stem
        out_filename = f"{stem}_textglide.epub"
        buf = io.BytesIO(epub_bytes)
        buf.seek(0)

        resp = send_file(
            buf,
            mimetype="application/epub+zip",
            as_attachment=True,
            download_name=out_filename,
        )

        if mode_used != mode:
            resp.headers["X-Fallback-Warning"] = _fallback_message(mode, mode_used)

        return resp

    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


def _fallback_message(requested: str, actual: str) -> str:
    names = {"pseudosyntactic": "Natural Scan", "syntactic": "Grammar Parse"}
    requested_label = names.get(requested, requested.capitalize())
    if actual == "keyword_fallback":
        return (
            f"{requested_label} mode was requested but the grammar model "
            "could not be loaded. A keyword heuristic was used instead."
        )
    return f"Mode requested: {requested_label}. Mode used: {actual}."


# Serve React app for all non-API routes (production/Docker only)
@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve_static(path):
    static_dir = os.path.join(os.path.dirname(__file__), 'static')
    if not os.path.exists(static_dir):
        return '', 204  # Dev environment — static dir not present, no-op
    if path and os.path.exists(os.path.join(static_dir, path)):
        return send_from_directory(static_dir, path)
    return send_from_directory(static_dir, 'index.html')


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    app.run(host="0.0.0.0", port=port, debug=False)
