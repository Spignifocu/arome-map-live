"""
Orchestrateur : télécharge les paquets GRIB2 AROME depuis le dépôt de
données ouvertes Météo-France (files.data.gouv.fr), les décode, les
ré-échantillonne sur la grille du front, écrit le cache JSON.

Usage :
    python fetch_and_build.py --list-runs            # voir les runs disponibles
    python fetch_and_build.py                          # dernier run complet, échéances par défaut
    python fetch_and_build.py --run 2026-07-21T00:00:00Z --steps 0,3,6

À planifier en cron après chaque nouveau run (00Z/06Z/12Z/18Z + les
runs intermédiaires 03/09/15/21Z selon ce qui est publié), par exemple :
    20 0,3,6,9,12,15,18,21 * * *  cd /path/to/backend && ./venv/bin/python fetch_and_build.py
(20 min de marge après l'heure du run pour laisser le temps à la publication)
"""
import argparse
import json
from datetime import datetime, timezone

import numpy as np

import config
from open_data_client import list_runs, list_step_files, download_file
from grib_processor import load_variable, regrid_to_domain, build_step_payload


def latest_run_iso():
    runs = list_runs()
    if not runs:
        raise RuntimeError("Aucun run trouvé sur le dépôt data.gouv.fr")
    return runs[-1]


def run_id_from_iso(run_iso):
    return run_iso.replace(":", "-")


def _try_load(raw_paths, package, var_conf):
    """Charge une variable, ou renvoie None si absente de ce fichier
    (cas normal pour les champs cumulés à l'échéance 0)."""
    try:
        da = load_variable(
            raw_paths[package],
            var_conf["short_name"],
            var_conf.get("type_of_level"),
            var_conf.get("level"),
        )
        return regrid_to_domain(da)
    except ValueError:
        return None


def fetch_and_build(run_iso, steps, cleanup_raw=True):
    run_id = run_id_from_iso(run_iso)
    step_cache_dir = config.CACHE_DIR / run_id
    step_cache_dir.mkdir(parents=True, exist_ok=True)

    # Si ce run est déjà entièrement en cache avec les mêmes échéances,
    # inutile de retélécharger quoi que ce soit (utile pour un cron qui
    # tourne plus souvent que la publication des runs).
    meta_path = config.CACHE_DIR / "meta.json"
    if meta_path.exists():
        try:
            existing = json.loads(meta_path.read_text())
            if existing.get("run") == run_iso and set(existing.get("steps", [])) >= set(steps):
                print(f"[fetch] run {run_iso} déjà en cache avec ces échéances, rien à faire.")
                return
        except (json.JSONDecodeError, OSError):
            pass

    # 1) Lister les fichiers réellement disponibles pour chaque paquet nécessaire
    package_files = {}
    for package in config.PACKAGES_NEEDED:
        available = list_step_files(run_iso, package)
        package_files[package] = available
        print(f"[fetch] paquet {package} : {len(available)} échéances disponibles")

    prev_precip_cum = None
    written_steps = []

    for step in steps:
        print(f"[fetch] run={run_iso} step=+{step}h ...")
        try:
            raw_paths = {}
            for package in config.PACKAGES_NEEDED:
                url = package_files[package].get(step)
                if not url:
                    raise RuntimeError(f"échéance +{step}h absente du paquet {package}")
                dest = config.RAW_DIR / f"{run_id}_{package}_{step}.grib2"
                if not dest.exists():
                    download_file(url, dest)
                raw_paths[package] = dest

            values = {}
            for var_key, var_conf in config.VARIABLES.items():
                da = load_variable(
                    raw_paths[var_conf["package"]],
                    var_conf["short_name"],
                    var_conf.get("type_of_level"),
                    var_conf.get("level"),
                )
                values[var_key] = regrid_to_domain(da)

            # Rafales : vecteur (est, nord) du maximum sur la période.
            # Absent à l'échéance 0 -> repli sur une estimation depuis le vent.
            gust_pkg = config.GUST_COMPONENTS["package"]
            gust_east = _try_load(raw_paths, gust_pkg, config.GUST_COMPONENTS["east"])
            gust_north = _try_load(raw_paths, gust_pkg, config.GUST_COMPONENTS["north"])
            if gust_east is not None and gust_north is not None:
                values["gust"] = np.sqrt(gust_east ** 2 + gust_north ** 2)
            else:
                wind_speed = np.sqrt(values["u10"] ** 2 + values["v10"] ** 2)
                values["gust"] = wind_speed * config.GUST_ESTIMATE_FACTOR
                print(f"  (rafales absentes à +{step}h, estimation depuis le vent)")

            # Précipitations : cumul pluie + neige depuis le début du run.
            # Absent à l'échéance 0 -> cumul nul.
            precip_pkg = config.PRECIP_COMPONENTS["package"]
            rain = _try_load(raw_paths, precip_pkg, config.PRECIP_COMPONENTS["rain"])
            snow = _try_load(raw_paths, precip_pkg, config.PRECIP_COMPONENTS["snow"])
            if rain is not None or snow is not None:
                precip_cum = (rain if rain is not None else 0) + (snow if snow is not None else 0)
            else:
                precip_cum = np.zeros_like(values["u10"])
                print(f"  (précipitations absentes à +{step}h, cumul mis à 0)")

        except Exception as e:
            print(f"  !! échec sur l'échéance +{step}h : {e}")
            continue

        # Cumul -> taux horaire par différence entre échéances successives.
        if prev_precip_cum is None:
            precip_rate = np.zeros_like(precip_cum)
        else:
            precip_rate = np.maximum(precip_cum - prev_precip_cum, 0) / config.STEP_HOURS
        prev_precip_cum = precip_cum

        payload = build_step_payload(values["u10"], values["v10"], values["gust"], values["t2m"], precip_rate, step)
        (step_cache_dir / f"{step}.json").write_text(json.dumps(payload))
        written_steps.append(step)
        print(f"  -> écrit {step}.json")

    if not written_steps:
        raise RuntimeError("Aucune échéance n'a pu être récupérée, voir les erreurs ci-dessus.")

    meta = {
        "run": run_iso,
        "run_id": run_id,
        "bounds": config.BOUNDS,
        "nx": config.NX,
        "ny": config.NY,
        "steps": written_steps,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    (config.CACHE_DIR / "meta.json").write_text(json.dumps(meta))
    print(f"[fetch] meta.json écrit — {len(written_steps)} échéances disponibles pour le run {run_iso}")

    if cleanup_raw:
        _cleanup_raw_files(run_id)
    _prune_old_cache_runs(keep_run_id=run_id)


def _cleanup_raw_files(run_id):
    """Supprime les GRIB2 bruts de ce run une fois le cache JSON écrit
    (les fichiers font ~20-25 Mo chacun, inutile de les garder)."""
    n = 0
    for f in config.RAW_DIR.glob(f"{run_id}_*.grib2"):
        f.unlink()
        n += 1
    if n:
        print(f"[fetch] {n} fichier(s) GRIB2 brut(s) nettoyé(s) pour {run_id}")


def _prune_old_cache_runs(keep_run_id, keep_last=2):
    """Garde seulement les `keep_last` runs les plus récents dans le
    cache (le run courant + un peu d'historique), supprime le reste."""
    run_dirs = sorted(
        (d for d in config.CACHE_DIR.iterdir() if d.is_dir()),
        key=lambda d: d.stat().st_mtime,
    )
    run_dirs = [d for d in run_dirs if d.name != keep_run_id]
    to_remove = run_dirs[:-(keep_last-1)] if keep_last > 1 else run_dirs
    for d in to_remove:
        for f in d.glob("*.json"):
            f.unlink()
        d.rmdir()
        print(f"[fetch] ancien run nettoyé du cache : {d.name}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--run", help="Run ISO8601 (ex 2026-07-21T00:00:00Z). Défaut: dernier run publié.")
    parser.add_argument("--steps", help="Échéances en heures séparées par des virgules (ex 0,3,6). Défaut: config.py")
    parser.add_argument("--list-runs", action="store_true", help="Liste les runs disponibles et quitte.")
    parser.add_argument("--keep-raw", action="store_true", help="Ne pas supprimer les GRIB2 bruts après traitement (debug).")
    args = parser.parse_args()

    if args.list_runs:
        for run in list_runs():
            print(run)
        return

    run_iso = args.run or latest_run_iso()
    steps = [int(s) for s in args.steps.split(",")] if args.steps else config.STEPS
    fetch_and_build(run_iso, steps, cleanup_raw=not args.keep_raw)


if __name__ == "__main__":
    main()
