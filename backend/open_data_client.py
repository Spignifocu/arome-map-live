"""
Client pour le dépôt de données ouvertes Météo-France sur data.gouv.fr :
    https://files.data.gouv.fr/meteofrance-pnt/pnt/

Aucune authentification nécessaire — ce sont des fichiers GRIB2 en
téléchargement HTTP direct, organisés ainsi (confirmé en explorant
manuellement l'arborescence, juillet 2026) :

    pnt/{run_iso}/arome/001/{PAQUET}/arome__001__{PAQUET}__{step}H__{run_iso}.grib2

- run_iso : ex "2026-07-21T00:00:00Z" (encodé en URL, ':' -> '%3A')
- 001 : résolution 0.01° (~1km, la plus fine — 0025 existe aussi en 0.025°)
- PAQUET : SP1/SP2/SP3 (paramètres de surface) ou HP1 (niveaux en altitude)
- step : échéance horaire depuis le run, ex "19H"

On ne devine jamais le nom exact d'un fichier : on récupère toujours le
listing HTML du dossier et on en extrait les liens réels (list_step_files),
ce qui reste correct même si Météo-France change le nombre d'échéances
disponibles ou le format exact des noms (zéro-padding, etc).
"""
import re
from urllib.parse import quote, unquote

import requests

BASE_URL = "https://files.data.gouv.fr/meteofrance-pnt/pnt"

DEFAULT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
}

HREF_RE = re.compile(r'href="([^"]+\.grib2)"')
STEP_RE = re.compile(r'__(\d+)H__')
RUN_DIR_RE = re.compile(r'href="/meteofrance-pnt/pnt/([^"/]+)/"')


def _run_path(run_iso):
    return quote(run_iso, safe="")


def list_runs():
    """Liste les dossiers de run disponibles à la racine, du plus ancien
    au plus récent. Le tout dernier n'est pas forcément complet si le
    run est encore en cours de publication."""
    r = requests.get(f"{BASE_URL}/", headers=DEFAULT_HEADERS, timeout=30)
    r.raise_for_status()
    runs = sorted(set(RUN_DIR_RE.findall(r.text)))
    return [unquote(r_) for r_ in runs]


def list_step_files(run_iso, package):
    """Renvoie {step_int: url_complete} pour un run + paquet donnés, en
    parsant le vrai listing HTML plutôt qu'en devinant les noms de fichiers."""
    url = f"{BASE_URL}/{_run_path(run_iso)}/arome/001/{package}/"
    r = requests.get(url, headers=DEFAULT_HEADERS, timeout=30)
    r.raise_for_status()
    result = {}
    for href in HREF_RE.findall(r.text):
        m = STEP_RE.search(href)
        if not m:
            continue
        step = int(m.group(1))
        full_url = href if href.startswith("http") else f"https://files.data.gouv.fr{href}"
        result[step] = full_url
    return result


def download_file(url, dest_path):
    r = requests.get(url, headers=DEFAULT_HEADERS, stream=True, timeout=120)
    r.raise_for_status()
    with open(dest_path, "wb") as f:
        for chunk in r.iter_content(chunk_size=1 << 20):
            f.write(chunk)
    return dest_path
