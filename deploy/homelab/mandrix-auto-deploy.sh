#!/bin/sh
# Déploiement automatique (dans le LXC Mandrix, toutes les 5 minutes via mandrix-auto-deploy.timer) :
# si la branche main du dépôt GitHub a avancé, on copie le nouveau code dans /opt/mandrix et on
# reconstruit. Le dépôt est public : récupération en HTTPS, sans clé (voir docs/SUPERVISION.md).
# Les PR ne sont fusionnées qu'une fois la CI verte.
set -eu
REPO=${REPO:-https://github.com/MatteoCnda1/Mandrix.git}
SRC=/opt/mandrix-src
DEST=/opt/mandrix
# Clé de déploiement, seulement si le dépôt redevient privé (REPO en git@github.com:…).
KEY=/root/.ssh/mandrix_deploy
if [ -f "$KEY" ]; then
  export GIT_SSH_COMMAND="ssh -i $KEY -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"
fi

[ -d "$SRC/.git" ] || git clone --quiet --branch main "$REPO" "$SRC"
git -C "$SRC" fetch --quiet origin main
new=$(git -C "$SRC" rev-parse origin/main)
old=$(cat "$DEST/.deployed" 2>/dev/null || echo none)
[ "$new" = "$old" ] && exit 0

echo "$(date -Is) déploiement $old -> $new"
git -C "$SRC" archive --format=tar "$new" | tar -x -C "$DEST"
cd "$DEST"
docker compose --profile tunnel up -d --build
echo "$new" > "$DEST/.deployed"
# Ménage : anciennes images et cache de construction, qui remplissait le pool LVM partagé par toutes les VM
# (incident du 24/11/2026). Penser à `pct fstrim 107` côté Proxmox pour rendre la place au pool.
docker image prune -f >/dev/null 2>&1 || true
docker builder prune -f >/dev/null 2>&1 || true
