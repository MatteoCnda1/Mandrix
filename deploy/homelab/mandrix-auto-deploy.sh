#!/bin/sh
# Déploiement automatique (dans le LXC Mandrix, toutes les 5 minutes via mandrix-auto-deploy.timer) :
# si la branche main du dépôt GitHub a avancé, on copie le nouveau code dans /opt/mandrix et on
# reconstruit. Le dépôt étant privé, il faut une clé de déploiement en lecture seule
# (voir docs/SUPERVISION.md). Les PR ne sont fusionnées qu'une fois la CI verte.
set -eu
REPO=${REPO:-git@github.com:MatteoCnda1/Mandrix.git}
SRC=/opt/mandrix-src
DEST=/opt/mandrix
export GIT_SSH_COMMAND="ssh -i /root/.ssh/mandrix_deploy -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"

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
# Ménage des anciennes images.
docker image prune -f >/dev/null 2>&1 || true
