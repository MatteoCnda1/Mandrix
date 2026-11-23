#!/bin/sh
# Supervision Mandrix, lancée toutes les 5 minutes sur le Proxmox (mandrix-watchdog.timer).
# - NAS injoignable deux fois de suite : Wake-on-LAN (wake-nas) et alerte ;
# - partage NFS figé ou disque presque plein : alerte ;
# - site public injoignable : redémarre le tunnel (ou l'app) dans le LXC et alerte.
# Les alertes arrivent en notification push chez les admins (POST /api/internal/alert).
set -u

CONF=/etc/mandrix-watchdog.env
[ -r "$CONF" ] && . "$CONF"
NAS_IP=${NAS_IP:-192.168.1.78}
NAS_MOUNT=${NAS_MOUNT:-/mnt/nas/mandrix}
CT=${CT:-107}
APP_LAN=${APP_LAN:-http://192.168.1.116:3000}
PUBLIC_URL=${PUBLIC_URL:-https://mandrix.rudylink.eu}
DISK_LIMIT=${DISK_LIMIT:-90}
STATE=/var/lib/mandrix-watchdog
mkdir -p "$STATE"

log() { logger -t mandrix-watchdog "$*"; echo "$*"; }

alert() { # alert <clé> <titre> <message>
  [ -n "${ALERT_TOKEN:-}" ] || { log "alerte (sans jeton) : $2 — $3"; return; }
  curl -fsS -m 10 -X POST "$APP_LAN/api/internal/alert" \
    -H "Authorization: Bearer $ALERT_TOKEN" -H 'content-type: application/json' \
    --data "{\"key\":\"$1\",\"title\":\"$2\",\"body\":\"$3\"}" >/dev/null 2>&1 || log "alerte non envoyée : $2"
}

# Compteur d'échecs consécutifs : fail <nom> renvoie le nombre d'échecs, ok <nom> remet à zéro.
fail() { n=$(( $(cat "$STATE/$1" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$STATE/$1"; echo "$n"; }
ok() { n=$(cat "$STATE/$1" 2>/dev/null || echo 0); echo 0 > "$STATE/$1"; [ "$n" -gt 0 ] && echo "$n" || echo 0; }

# ——— NAS ———
if ping -c 2 -W 2 "$NAS_IP" >/dev/null 2>&1; then
  if [ "$(ok nas)" -ge 2 ]; then
    log "NAS revenu"
    alert nas "NAS revenu ✅" "Le NAS répond de nouveau. Photos et sauvegardes sont accessibles."
  fi
  if ! timeout 15 stat "$NAS_MOUNT" >/dev/null 2>&1; then
    [ "$(fail mount)" -eq 2 ] && alert mount "Partage NAS figé" "Le montage $NAS_MOUNT ne répond pas alors que le NAS est joignable."
  else
    ok mount >/dev/null
  fi
else
  n=$(fail nas)
  if [ "$n" -eq 2 ] || [ $(( n % 12 )) -eq 0 ]; then
    log "NAS injoignable ($n), réveil"
    command -v wake-nas >/dev/null && wake-nas >/dev/null 2>&1
    alert nas "NAS injoignable ⚠️" "Le NAS ne répond plus depuis $(( n * 5 )) min. Réveil Wake-on-LAN envoyé."
  fi
fi

# ——— Espace disque (une alerte par jour au plus) ———
for target in / "$NAS_MOUNT"; do
  used=$(timeout 15 df -P "$target" 2>/dev/null | awk 'NR==2 {gsub("%","",$5); print $5}')
  [ -n "$used" ] || continue
  key=disk$(echo "$target" | tr '/' '_')
  if [ "$used" -ge "$DISK_LIMIT" ]; then
    today=$(date +%F)
    if [ "$(cat "$STATE/$key" 2>/dev/null)" != "$today" ]; then
      echo "$today" > "$STATE/$key"
      alert "$key" "Disque presque plein" "$target est rempli à $used %."
    fi
  fi
done

# ——— Site public ———
if curl -fsS -m 15 -o /dev/null "$PUBLIC_URL/api/config"; then
  if [ "$(ok site)" -ge 2 ]; then
    log "site revenu"
    alert site "Mandrix est de retour ✅" "$PUBLIC_URL répond de nouveau."
  fi
else
  n=$(fail site)
  if [ "$n" -eq 2 ]; then
    if curl -fsS -m 10 -o /dev/null "$APP_LAN/api/config"; then
      log "site public injoignable, app OK : redémarrage du tunnel"
      pct exec "$CT" -- sh -c 'cd /opt/mandrix && docker compose --profile tunnel restart cloudflared' >/dev/null 2>&1
      alert site "Tunnel Cloudflare en panne" "Le site public ne répond plus depuis 10 min ; le tunnel a été redémarré."
    else
      log "app injoignable : redémarrage de la pile"
      pct exec "$CT" -- sh -c 'cd /opt/mandrix && docker compose --profile tunnel up -d' >/dev/null 2>&1
      # L'app est peut-être encore en train de démarrer : l'alerte part au retour (« Mandrix est de retour »).
    fi
  fi
fi
