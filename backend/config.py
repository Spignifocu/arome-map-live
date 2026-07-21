"""
Configuration centrale du backend.

Les valeurs de domaine (BOUNDS/NX/NY) et d'échéances (STEP_HOURS/N_STEPS)
doivent rester cohérentes avec celles utilisées côté front dans
frontend/js/data-mock.js, sinon le rendu du dégradé couleur / des
particules sera décalé par rapport à la grille réelle.
"""
import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

BACKEND_DIR = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("DATA_DIR", BACKEND_DIR.parent / "data")).resolve()
RAW_DIR = DATA_DIR / "raw"
CACHE_DIR = DATA_DIR / "cache"

for d in (DATA_DIR, RAW_DIR, CACHE_DIR):
    d.mkdir(parents=True, exist_ok=True)

# ---- Domaine géographique (Corse + Méditerranée proche) ----
# Garder identique à BOUNDS dans frontend/js/data-mock.js
BOUNDS = {"latMin": 41.0, "latMax": 43.4, "lonMin": 7.3, "lonMax": 9.9}
NX, NY = 26, 22

# ---- Échéances de prévision ----
# Les fichiers sources sont horaires (voir open_data_client.list_step_files),
# mais on n'en télécharge qu'une partie pour limiter la volumétrie
# (chaque fichier ~20-25 Mo). Par défaut : toutes les 3h jusqu'à +48h.
STEP_HOURS = 3
N_STEPS = 17  # 0..48h
STEPS = list(range(0, STEP_HOURS * N_STEPS, STEP_HOURS))

# ---- Résolution du domaine source AROME ouvert sur data.gouv.fr ----
AROME_RESOLUTION = "001"  # "001" = 0.01° (~1km), "0025" = 0.025°

# ---- Paquets GRIB2 -> variables ----
# Confirmé/à confirmer avec grib_processor.inspect_grib() sur un fichier
# réel téléchargé (voir README, étape "identifier les paquets").
# Renseigne le paquet ("SP1", "SP2", "SP3"...) où se trouve chaque
# variable, une fois vérifié.
VARIABLES = {
    "u10": {"package": "SP1", "short_name": "10u", "type_of_level": "heightAboveGround", "level": 10},
    "v10": {"package": "SP1", "short_name": "10v", "type_of_level": "heightAboveGround", "level": 10},
    "t2m": {"package": "SP1", "short_name": "2t",  "type_of_level": "heightAboveGround", "level": 2},
}

# Rafales : pas un champ scalaire unique, mais deux composantes du
# vecteur "maximum sur la période" (confirmé par inspection le 21/07/2026) :
#   max_10efg = composante est, max_10nfg = composante nord
# -> vitesse de rafale = sqrt(est² + nord²). Absent à l'échéance 0 (rien
# à cumuler à l'instant initial) : fetch_and_build.py gère ce cas en
# retombant sur une estimation depuis le vent moyen pour cette échéance-là.
GUST_COMPONENTS = {
    "package": "SP1",
    "east":  {"short_name": "max_10efg", "type_of_level": "heightAboveGround", "level": 10},
    "north": {"short_name": "max_10nfg", "type_of_level": "heightAboveGround", "level": 10},
}
GUST_ESTIMATE_FACTOR = 1.4  # utilisé seulement en repli (échéance 0)

# Précipitations : cumul pluie + neige depuis le début du run (confirmé
# par inspection le 21/07/2026). Absent à l'échéance 0 pour la même
# raison que les rafales.
PRECIP_COMPONENTS = {
    "package": "SP2",
    "rain": {"short_name": "tirf",    "type_of_level": "surface", "level": 0},
    "snow": {"short_name": "tsnowp",  "type_of_level": "surface", "level": 0},
}

PACKAGES_NEEDED = sorted(set(
    [v["package"] for v in VARIABLES.values()]
    + [GUST_COMPONENTS["package"]]
    + [PRECIP_COMPONENTS["package"]]
))
