#!/bin/sh
# Chaque semaine sur le Proxmox (homelab-fstrim.timer) : rend au pool LVM « thin » pve/data la place
# libérée dans les conteneurs. Un fichier supprimé dans un conteneur (transcodage Plex, téléchargements,
# construction Docker…) reste compté comme occupé dans le pool tant qu'on ne fait pas de fstrim : le pool
# se remplit alors sans que les disques le soient vraiment (incident du 24/11/2026).
# Ne supprime aucun fichier. Journal : journalctl -t homelab-fstrim
set -u
POOL=${POOL:-pve/data}

pool() { lvs --noheadings -o data_percent "$POOL" 2>/dev/null | tr -d ' '; }

before=$(pool)
for id in $(pct list | awk 'NR>1 && $2 == "running" {print $1}'); do
  # Seulement le disque du conteneur : les dossiers partagés (NAS, médias) ne viennent pas du pool,
  # et ceux montés en lecture seule font échouer fstrim (« Permission denied »).
  # pct fstrim peut répondre « Permission denied » avec un code de succès : on se fie à son message.
  out=$(pct fstrim "$id" --ignore-mountpoints 1 2>&1)
  if printf '%s' "$out" | grep -q 'trimmed'; then
    logger -t homelab-fstrim "CT $id : ${out##*: }"
  else
    # Repli : pct refuse certains conteneurs (« read-only check failed », vu sur le 105 avec /dev/net/tun).
    # fstrim lancé dans l'espace de montage du conteneur, avec les droits de l'hôte : seul son disque est traité.
    pid=$(lxc-info -n "$id" -p -H 2>/dev/null)
    if [ -n "$pid" ] && out2=$(nsenter -t "$pid" -m -- fstrim -v / 2>&1); then
      logger -t homelab-fstrim "CT $id : ${out2##*: } (nsenter)"
    else
      logger -t homelab-fstrim "CT $id : échec ($out)"
    fi
  fi
done
logger -t homelab-fstrim "pool $POOL : $before % → $(pool) %"
