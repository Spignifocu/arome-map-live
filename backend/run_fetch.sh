#!/bin/bash
# Wrapper pour cron : active le venv, empêche deux exécutions simultanées
# (utile si un fetch prend plus de temps que l'intervalle du cron), et
# journalise. fetch_and_build.py est déjà idempotent (il saute tout seul
# si le run courant est déjà en cache), donc ce script peut être appelé
# aussi souvent que tu veux sans gaspiller de bande passante.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

LOCK_FILE="/tmp/arome-fetch.lock"
LOG_FILE="${SCRIPT_DIR}/../data/fetch.log"

exec 200>"$LOCK_FILE"
if ! flock -n 200; then
    echo "$(date -u '+%Y-%m-%d %H:%M:%S') UTC - une exécution est déjà en cours, on saute." >> "$LOG_FILE"
    exit 0
fi

echo "$(date -u '+%Y-%m-%d %H:%M:%S') UTC - démarrage" >> "$LOG_FILE"
./venv/bin/python fetch_and_build.py >> "$LOG_FILE" 2>&1
STATUS=$?
echo "$(date -u '+%Y-%m-%d %H:%M:%S') UTC - terminé (code $STATUS)" >> "$LOG_FILE"
exit $STATUS
