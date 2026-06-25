"""
PhraseFlow — Flask backend.

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

from flask import Flask, jsonify, request, send_file

from epub_processor import (
    detect_language,
    is_drm_protected,
    preview_text,
    process_epub,
)

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024  # 50 MB


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
_VALID_WIDTHS = {"subtle", "medium", "strong"}
_VALID_DENSITIES = {"subtle", "medium", "obvious"}
_VALID_LANGS = {"auto", "en", "es"}


def _safe(value: str, allowed: set, default: str) -> str:
    v = (value or "").strip().lower()
    return v if v in allowed else default


# ---------------------------------------------------------------------------
# Healthz
# ---------------------------------------------------------------------------

@app.route("/api/healthz", methods=["GET", "OPTIONS"])
def healthz():
    if request.method == "OPTIONS":
        return "", 204
    return jsonify({"status": "ok"})


# ---------------------------------------------------------------------------
# /api/preview — plain-text spacing preview
# ---------------------------------------------------------------------------

@app.route("/api/preview", methods=["POST", "OPTIONS"])
def preview():
    if request.method == "OPTIONS":
        return "", 204

    data = request.get_json(silent=True) or {}
    text = str(data.get("text", ""))[:2000]  # cap input
    mode = _safe(data.get("mode", "simple"), _VALID_MODES, "simple")
    spacing_width = _safe(data.get("spacing_width", "subtle"), _VALID_WIDTHS, "subtle")
    chunk_density = _safe(data.get("chunk_density", "subtle"), _VALID_DENSITIES, "subtle")
    language = _safe(data.get("language", "auto"), _VALID_LANGS, "auto")

    if not text.strip():
        return jsonify({"result": "", "mode_used": mode})

    try:
        result, mode_used = preview_text(text, mode, spacing_width, chunk_density, language)
        return jsonify({"result": result, "mode_used": mode_used})
    except Exception:
        traceback.print_exc()
        return jsonify({"error": "Preview failed."}), 500


# ---------------------------------------------------------------------------
# /api/process — EPUB upload → processed EPUB download
# ---------------------------------------------------------------------------

@app.route("/api/process", methods=["POST", "OPTIONS"])
def process():
    if request.method == "OPTIONS":
        return "", 204

    if "file" not in request.files:
        return jsonify({"error": "No file uploaded."}), 400

    file = request.files["file"]
    if not file.filename:
        return jsonify({"error": "Empty filename."}), 400
    if not file.filename.lower().endswith(".epub"):
        return jsonify({"error": "Please upload an EPUB file (.epub)."}), 400

    mode = _safe(request.form.get("mode", "simple"), _VALID_MODES, "simple")
    spacing_width = _safe(request.form.get("spacing_width", "subtle"), _VALID_WIDTHS, "subtle")
    chunk_density = _safe(request.form.get("chunk_density", "subtle"), _VALID_DENSITIES, "subtle")
    language = _safe(request.form.get("language", "auto"), _VALID_LANGS, "auto")

    tmp_dir = tempfile.mkdtemp(prefix="phraseflow_")
    try:
        input_path = os.path.join(tmp_dir, "input.epub")
        file.save(input_path)

        # DRM check
        try:
            if is_drm_protected(input_path):
                return jsonify({
                    "error": (
                        "This EPUB is DRM-protected. PhraseFlow only works with "
                        "DRM-free books. Please use a DRM-free copy."
                    )
                }), 422
        except Exception:
            return jsonify({"error": "Could not read the EPUB. Please check it is a valid, unencrypted EPUB file."}), 400

        try:
            epub_bytes, mode_used = process_epub(
                input_path, mode, spacing_width, chunk_density, language
            )
        except Exception:
            traceback.print_exc()
            return jsonify({"error": "Processing failed. The file may be malformed."}), 500

        stem = Path(file.filename).stem
        out_filename = f"{stem}_phraseflow.epub"
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
    if actual == "keyword_fallback":
        return (
            f"{requested.capitalize()} mode was requested but the grammar model "
            "could not be loaded. A keyword heuristic was used instead."
        )
    return f"Mode requested: {requested}. Mode used: {actual}."


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    app.run(host="0.0.0.0", port=port, debug=False)
