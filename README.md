# AROME · Méditerranée — carte météo avec vraies données

Version « données réelles » du prototype précédent : même front (carte,
particules de vent, calques, timeline), mais alimenté par un backend
Python qui télécharge et décode les GRIB2 AROME publiés en accès libre
par Météo-France sur data.gouv.fr — **aucune clé API, aucune
authentification nécessaire.**

## Statut honnête sur ce qui a été testé, et ce qui ne l'a pas été

- ✅ Le décodage GRIB2 (eccodes/cfgrib/xarray), le ré-échantillonnage
  vers la grille du front, et la sérialisation JSON ont été testés de
  bout en bout.
- ✅ Le serveur Flask (sert le front + le cache JSON) a été testé et
  répond correctement, y compris le message d'erreur propre quand il
  n'y a pas encore de cache.
- ✅ Le front bascule automatiquement sur les données factices si le
  backend ou le cache est indisponible (donc l'appli ne casse jamais).
- ✅ La structure du dépôt data.gouv.fr (dossiers par run, paquets
  SP1/SP2/SP3/HP1, noms de fichiers) a été confirmée en explorant
  manuellement l'arborescence réelle.
- ⚠️ **Le mapping exact variable → paquet (SP1/SP2/SP3) reste à
  confirmer** avec `inspect_grib()` sur un vrai fichier téléchargé —
  mon environnement ne peut pas atteindre `files.data.gouv.fr` pour le
  faire moi-même. `config.py` contient ma meilleure estimation (vent/
  rafales/température dans SP1, précipitations dans SP2), à ajuster
  selon ce que révèle l'inspection.

## Structure

```
arome-map-live/
├── backend/
│   ├── requirements.txt
│   ├── .env.example          → à copier en .env (juste pour DATA_DIR, optionnel)
│   ├── config.py             Domaine géo, grille, échéances, mapping variable->paquet
│   ├── open_data_client.py   Téléchargement direct (pas d'auth) + parsing du listing HTML
│   ├── grib_processor.py     Décodage GRIB2 + ré-échantillonnage (testé ✅)
│   ├── fetch_and_build.py    Orchestrateur : télécharge, décode, écrit le cache JSON
│   └── server.py             Sert le front + le cache JSON (testé ✅)
├── frontend/                 Front adapté (charge les vraies données, secours mock)
│   ├── index.html
│   ├── css/style.css
│   └── js/{data.js, data-mock.js, particles.js, app.js}
└── data/
    ├── raw/                  GRIB2 bruts téléchargés (créé automatiquement)
    └── cache/                JSON générés, servis par server.py
```

## Étape 1 — Installer le backend

```bash
cd arome-map-live/backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

Si tu as l'erreur `NumPy was built with baseline optimizations (X86_V2)...`,
ton CPU (souvent virtualisé) n'a pas les instructions requises par les
wheels NumPy récentes. `requirements.txt` épingle déjà `numpy<1.25` pour
éviter ça — si tu avais installé une version différente avant, refais
`pip uninstall -y numpy && pip install "numpy<1.25"`.

## Étape 2 — Confirmer le mapping variable → paquet GRIB

```bash
# Repérer un run et une échéance disponibles
python fetch_and_build.py --list-runs

# Télécharger un seul fichier SP1 pour inspection (remplace la date/heure
# par un run réel vu dans la liste ci-dessus)
curl -o /tmp/test_sp1.grib2 "https://files.data.gouv.fr/meteofrance-pnt/pnt/2026-07-08T00%3A00%3A00Z/arome/001/SP1/arome__001__SP1__19H__2026-07-08T00%3A00%3A00Z.grib2"

python3 -c "from grib_processor import inspect_grib; inspect_grib('/tmp/test_sp1.grib2')"
```

Ça affiche tous les `shortName` présents dans SP1. Si `10u`/`10v`/`10fg`/`2t`
y sont bien, `config.py` est déjà correct pour ces 4 variables. Fais
pareil avec un fichier SP2 pour confirmer où se trouvent les
précipitations (`tp`) — si ce n'est pas dans SP2, ajuste le `"package"`
correspondant dans `config.py` (dictionnaire `VARIABLES`).

## Étape 3 — Premier téléchargement complet

```bash
python fetch_and_build.py
```

Sans argument, ça prend le run le plus récent publié et télécharge les
échéances par défaut (0 à 48h, toutes les 3h — configurable dans
`config.py` via `STEPS`). Ça écrit `data/cache/meta.json` et
`data/cache/<run>/<step>.json`.

⚠️ Chaque fichier GRIB2 fait ~20-25 Mo — pour 17 échéances × 2 paquets
(SP1+SP2), ça représente environ 800 Mo à télécharger par run. Réduis
`config.STEPS` si ta bande passante/disque est limité (par exemple, ne
garder que 0,6,12,18,24,30,36,42,48 pour un pas de 6h).

## Étape 4 — Lancer le serveur

```bash
python server.py
```

Ouvre `http://localhost:8000` — bandeau "AROME — RUN RÉEL" si le cache
est présent, sinon bascule automatique sur "BACKEND INDISPONIBLE"
(données factices).

## Étape 5 — Automatiser le rafraîchissement

`fetch_and_build.py` est **idempotent** : s'il détecte que le run demandé
est déjà entièrement en cache, il ne retélécharge rien. Ça veut dire que
tu peux le lancer aussi souvent que tu veux (par exemple toutes les 15
minutes) sans gaspiller de bande passante — il se contente d'attendre
que Météo-France publie le run suivant.

Utilise le script `run_fetch.sh` fourni plutôt que d'appeler
`fetch_and_build.py` directement en cron : il ajoute un verrou
(`flock`) pour éviter que deux exécutions se chevauchent si un fetch
prend plus de temps que prévu, et journalise dans `data/fetch.log`.

```bash
chmod +x run_fetch.sh   # une seule fois
```

Exemple de crontab (toutes les 15 min — le script lui-même évite le
gaspillage grâce à l'idempotence) :

```
*/15 * * * *  /chemin/vers/backend/run_fetch.sh
```

Ou, plus économe en requêtes de vérification, aligné sur le rythme de
publication des runs (toutes les 3h + marge) :

```
20 */3 * * *  /chemin/vers/backend/run_fetch.sh
```

Le script nettoie aussi automatiquement :
- les GRIB2 bruts du run une fois le cache JSON écrit (ils ne servent
  plus à rien ensuite, et pèsent ~20-25 Mo chacun) ;
- les anciens runs en cache, en ne gardant que les 2 plus récents
  (évite que `data/cache/` grossisse indéfiniment).

## Notes / limites connues

- Les fichiers GRIB2 bruts sont nommés avec l'identifiant du run
  (`{run_id}_{paquet}_{échéance}.grib2`) pour ne jamais réutiliser par
  erreur les fichiers d'un run précédent.
- Les précipitations AROME sont fournies en cumul depuis le début du
  run : `fetch_and_build.py` calcule un taux horaire par différence
  entre échéances successives. À vérifier une fois `inspect_grib`
  passé sur un vrai fichier SP2/SP3.
- Les rafales (`10fg`) sont supposées déjà en m/s — à confirmer aussi.
- La liste des fichiers disponibles est toujours récupérée en direct
  (`list_step_files`) plutôt que devinée, donc le pipeline s'adapte
  automatiquement si Météo-France change le nombre d'échéances
  publiées ou la convention de nommage des fichiers.
- La grille cible (Corse/Méditerranée, 26×22 points) est définie dans
  `backend/config.py`, à garder cohérente avec `BOUNDS`/`NX`/`NY` dans
  `frontend/js/data-mock.js` si tu changes la zone géographique.
