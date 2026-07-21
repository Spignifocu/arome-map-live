"""
Sert le front (frontend/) et expose le cache JSON (data/cache/) sous
/data/... — c'est exactement l'arborescence que frontend/js/data.js
va chercher (data/meta.json, data/<run_id>/<step>.json).

Lancement :
    python server.py
    -> http://localhost:8000

Le cache est écrit par fetch_and_build.py ; ce serveur ne fait que le
lire et le distribuer, il ne télécharge/décode rien lui-même.
"""
from pathlib import Path
from flask import Flask, send_from_directory, jsonify

import config

FRONTEND_DIR = (Path(__file__).resolve().parent.parent / "frontend").resolve()

app = Flask(__name__, static_folder=None)


@app.route("/")
def index():
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.route("/<path:path>")
def frontend_files(path):
    # Les requêtes /data/... sont interceptées par les routes ci-dessous
    if path.startswith("data/"):
        return _serve_data(path[len("data/"):])
    return send_from_directory(FRONTEND_DIR, path)


def _serve_data(rel_path):
    full = config.CACHE_DIR / rel_path
    if not full.exists():
        return jsonify({"error": "pas encore de données en cache — lance fetch_and_build.py"}), 404
    return send_from_directory(config.CACHE_DIR, rel_path)


if __name__ == "__main__":
    print(f"Front servi depuis : {FRONTEND_DIR}")
    print(f"Cache de données   : {config.CACHE_DIR}")
    app.run(host="0.0.0.0", port=8000, debug=True)
