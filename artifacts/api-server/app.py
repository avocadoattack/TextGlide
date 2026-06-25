"""
Phrase-Spacing EPUB Injector — Flask backend.

Routes:
  GET  /api/healthz       — liveness probe
  POST /api/process       — upload EPUB, return processed EPUB
"""

import os
import tempfile
import traceback
from pathlib import Path

from flask import Flask, jsonify, request, send_file

from epub_processor import is_drm_protected, process_epub, spacy_available

app = Flask(__name__)

# Max upload size: 50 MB
app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024


# ---------------------------------------------------------------------------
# CORS — allow the Vite dev server and the production proxy
# ---------------------------------------------------------------------------

@app.after_request
def add_cors(response):
    origin = request.headers.get("Origin", "")
    response.headers["Access-Control-Allow-Origin"] = origin or "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    response.headers["Access-Control-Allow-Credentials"] = "true"
    return response


@app.route("/api/healthz", methods=["GET", "OPTIONS"])
def healthz():
    if request.method == "OPTIONS":
        return "", 204
    return jsonify({"status": "ok"})


# ---------------------------------------------------------------------------
# Main processing endpoint
# ---------------------------------------------------------------------------

@app.route("/api/process", methods=["POST", "OPTIONS"])
def process():
    if request.method == "OPTIONS":
        return "", 204

    # --- validate inputs ---
    if "file" not in request.files:
        return jsonify({"error": "No file uploaded."}), 400

    file = request.files["file"]
    if not file.filename:
        return jsonify({"error": "Empty filename."}), 400

    name_lower = file.filename.lower()
    if not name_lower.endswith(".epub"):
        return jsonify({"error": "Please upload an EPUB file (.epub extension required)."}), 400

    mode = request.form.get("mode", "simple").lower().strip()
    if mode not in ("simple", "smart"):
        mode = "simple"

    intensity = request.form.get("intensity", "medium").lower().strip()
    if intensity not in ("subtle", "medium", "strong"):
        intensity = "medium"

    # --- work in a temp directory that is always cleaned up ---
    tmp_dir = tempfile.mkdtemp(prefix="epub_injector_")
    try:
        input_path = os.path.join(tmp_dir, "input.epub")
        file.save(input_path)

        # DRM check
        try:
            if is_drm_protected(input_path):
                return jsonify({
                    "error": (
                        "This EPUB appears to be DRM-protected. "
                        "Phrase-Spacing EPUB Injector only works with DRM-free books. "
                        "Please use a DRM-free copy."
                    )
                }), 422
        except Exception:
            return jsonify({"error": "Could not read the EPUB file. Please check it is a valid EPUB."}), 400

        # Process
        fell_back = False
        try:
            epub_bytes, fell_back = process_epub(input_path, mode, intensity)
        except Exception:
            traceback.print_exc()
            return jsonify({"error": "Processing failed. The file may be malformed."}), 500

        # Build output filename
        stem = Path(file.filename).stem
        out_filename = f"{stem}_phrase_spaced.epub"

        # Stream the result back
        import io
        buf = io.BytesIO(epub_bytes)
        buf.seek(0)

        response = send_file(
            buf,
            mimetype="application/epub+zip",
            as_attachment=True,
            download_name=out_filename,
        )

        if fell_back:
            response.headers["X-Fallback-Warning"] = (
                "Smart mode was requested but the spaCy model could not be loaded. "
                "Simple mode was used instead."
            )

        return response

    finally:
        import shutil
        shutil.rmtree(tmp_dir, ignore_errors=True)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    app.run(host="0.0.0.0", port=port, debug=False)
