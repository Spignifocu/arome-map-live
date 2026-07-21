"""
Décodage des GRIB2 AROME et ré-échantillonnage vers la grille régulière
consommée par le front (NX x NY points sur BOUNDS, voir config.py).

Testé dans le bac à sable de développement avec un GRIB2 synthétique
généré via eccodes (round-trip cfgrib.open_dataset OK) — mais jamais
contre un vrai fichier AROME, puisque ce sandbox ne peut pas atteindre
les serveurs Météo-France. À valider avec `inspect_grib()` sur ton
premier fichier téléchargé pour vérifier les noms de variables réels.
"""
import numpy as np
import cfgrib

import config


def inspect_grib(path):
    """Affiche toutes les variables présentes dans un fichier GRIB2 (debug).

    Itère directement les messages via eccodes plutôt que de passer par
    cfgrib.open_dataset() : les fichiers AROME mélangent souvent plusieurs
    niveaux (ex heightAboveGround=2m pour t2m et =10m pour u10/v10), ce qui
    fait échouer la fusion en un seul Dataset xarray et masque des
    variables. L'itération brute ne rencontre pas ce problème.
    """
    import eccodes

    def safe_get(gid, key, default="?"):
        try:
            return eccodes.codes_get(gid, key)
        except Exception:
            return default

    seen = []
    with open(path, "rb") as f:
        while True:
            gid = eccodes.codes_grib_new_from_file(f)
            if gid is None:
                break
            try:
                info = {
                    "shortName": safe_get(gid, "shortName"),
                    "paramId": safe_get(gid, "paramId"),
                    "typeOfLevel": safe_get(gid, "typeOfLevel"),
                    "level": safe_get(gid, "level"),
                    "name": safe_get(gid, "name"),
                }
                seen.append(info)
                print(f"  shortName={info['shortName']!r:12} paramId={info['paramId']!s:<10} "
                      f"typeOfLevel={info['typeOfLevel']!s:<18} level={info['level']!s:<4} name={info['name']}")
            finally:
                eccodes.codes_release(gid)
    print(f"--- {len(seen)} message(s) dans {path} ---")
    return seen


def load_variable(path, short_name, type_of_level=None, level=None):
    """Ouvre un GRIB2 et renvoie le DataArray correspondant à shortName
    (et éventuellement type/niveau, utile si le fichier contient
    plusieurs messages, ex plusieurs niveaux verticaux)."""
    filter_keys = {"shortName": short_name}
    if type_of_level:
        filter_keys["typeOfLevel"] = type_of_level
    if level is not None:
        filter_keys["level"] = level

    ds = cfgrib.open_dataset(path, backend_kwargs={"filter_by_keys": filter_keys})
    if not ds.data_vars:
        raise ValueError(
            f"Aucune variable trouvée dans {path} pour shortName={short_name}. "
            f"Utilise inspect_grib('{path}') pour voir les shortName réels du fichier."
        )
    varname = list(ds.data_vars)[0]
    return ds[varname]


def regrid_to_domain(da, bounds=None, nx=None, ny=None):
    """Ré-échantillonne un DataArray 2D (lat, lon) vers la grille régulière
    NX*NY attendue par le front, par interpolation bilinéaire.
    Renvoie un tableau numpy 1D de taille nx*ny, en ordre j*nx+i avec
    j=0 au nord (même convention que gridIndexFor côté front)."""
    bounds = bounds or config.BOUNDS
    nx = nx or config.NX
    ny = ny or config.NY

    lat_name = "latitude" if "latitude" in da.dims else "lat"
    lon_name = "longitude" if "longitude" in da.dims else "lon"

    target_lats = np.linspace(bounds["latMax"], bounds["latMin"], ny)  # nord -> sud
    target_lons = np.linspace(bounds["lonMin"], bounds["lonMax"], nx)  # ouest -> est

    interpolated = da.interp({lat_name: target_lats, lon_name: target_lons}, method="linear")
    arr = interpolated.values.astype(np.float32)

    if arr.shape != (ny, nx):
        arr = arr.reshape(ny, nx)

    # Combler d'éventuels NaN (hors domaine source) par le voisin le plus proche
    if np.isnan(arr).any():
        mask = np.isnan(arr)
        if mask.all():
            raise ValueError("Ré-échantillonnage entièrement NaN — le sous-domaine "
                              "demandé ne recoupe probablement pas le fichier source.")
        arr[mask] = np.nanmean(arr)

    return arr.flatten()


def build_step_payload(u10, v10, gust, t2m, precip_rate, hour):
    """Assemble le JSON consommé par frontend/js/data.js pour une échéance."""
    return {
        "hour": hour,
        "u": u10.tolist(),
        "v": v10.tolist(),
        "gust": gust.tolist(),
        "temp": (t2m - 273.15).tolist() if _looks_kelvin(t2m) else t2m.tolist(),
        "precip": precip_rate.tolist(),
    }


def _looks_kelvin(arr):
    # Heuristique simple : AROME donne t2m en Kelvin (valeurs ~250-320)
    return float(np.nanmean(arr)) > 100
