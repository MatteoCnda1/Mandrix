#!/bin/sh
# Contrôle hebdomadaire des sauvegardes, lancé dans le LXC Mandrix (depuis le Proxmox :
# pct exec 107 -- /opt/mandrix/deploy/homelab/mandrix-restore-check.sh).
# Restaure la dernière sauvegarde dans une base jetable, compare quelques comptages avec la base
# réelle, puis supprime la base de test. En cas d'échec : alerte push aux admins.
set -u
cd /opt/mandrix || exit 1
# Seules deux valeurs du .env sont lues (sans l'exécuter).
envv() { grep -E "^$1=" .env 2>/dev/null | tail -n 1 | cut -d= -f2- | tr -d '"'"'"; }
ALERT_TOKEN=$(envv ALERT_TOKEN)
APP_PORT=$(envv APP_PORT)
APP=http://127.0.0.1:${APP_PORT:-3000}
TEST_DB=mandrix_restore_check

alert() {
  [ -n "${ALERT_TOKEN:-}" ] || { echo "alerte (sans jeton) : $1 — $2"; return; }
  curl -fsS -m 10 -X POST "$APP/api/internal/alert" -H "Authorization: Bearer $ALERT_TOKEN" -H 'content-type: application/json' \
    --data "{\"key\":\"backup\",\"title\":\"$1\",\"body\":\"$2\"}" >/dev/null 2>&1 || echo "alerte non envoyée"
}

sh_backup() { docker compose exec -T backup sh -c "$1"; }

latest=$(sh_backup 'ls -1t /backups/mandrix-*.dump 2>/dev/null | head -n 1' | tr -d '\r')
if [ -z "$latest" ]; then
  alert "Sauvegarde introuvable ⚠️" "Aucun fichier mandrix-*.dump dans le dossier des sauvegardes."
  exit 1
fi
age_days=$(sh_backup "echo \$(( (\$(date +%s) - \$(stat -c %Y $latest)) / 86400 ))" | tr -d '\r')

restore="dropdb -h db -U mandrix --if-exists $TEST_DB && createdb -h db -U mandrix $TEST_DB && pg_restore -h db -U mandrix -d $TEST_DB --no-owner --exit-on-error $latest"
if ! sh_backup "$restore" >/tmp/mandrix-restore.log 2>&1; then
  alert "Sauvegarde illisible ⚠️" "La restauration de $(basename "$latest") a échoué. Voir /tmp/mandrix-restore.log dans le LXC."
  sh_backup "dropdb -h db -U mandrix --if-exists $TEST_DB" >/dev/null 2>&1
  exit 1
fi

# « comptes|posts » d'une base.
count() { sh_backup "psql -h db -U mandrix -d $1 -tA -c 'select (select count(*) from users), (select count(*) from posts)'" | tr -d '\r'; }
restored=$(count $TEST_DB)
live=$(count mandrix)
sh_backup "dropdb -h db -U mandrix --if-exists $TEST_DB" >/dev/null 2>&1

users_r=${restored%%|*}
users_l=${live%%|*}
if [ -z "$users_r" ] || [ "$users_r" -eq 0 ] || [ "$users_r" -lt $(( users_l * 9 / 10 )) ] || [ "$age_days" -gt 2 ]; then
  alert "Sauvegarde suspecte ⚠️" "$(basename "$latest") ($age_days j) : $restored (comptes|posts) restaurés contre $live en base."
  exit 1
fi
echo "$(date -Is) restauration OK : $(basename "$latest"), comptes/posts $restored (base : $live)" | tee -a /var/log/mandrix-restore-check.log
