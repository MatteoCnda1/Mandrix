# Supervision et déploiement automatique (homelab)

Scripts dans [`deploy/homelab/`](../deploy/homelab). Les alertes arrivent en **notification push chez les admins**
de Mandrix (route `POST /api/internal/alert`, protégée par `ALERT_TOKEN`).

## 1. Jeton d'alerte

Sur le LXC Mandrix, ajouter un jeton aléatoire au `.env` puis relancer l'app :

```bash
pct exec 107 -- sh -c 'cd /opt/mandrix && echo "ALERT_TOKEN=$(openssl rand -hex 32)" >> .env && docker compose up -d app'
```

Le même jeton doit figurer dans `/etc/mandrix-watchdog.env` sur le Proxmox (étape 2). Ne jamais le commiter.

## 2. Watchdog (Proxmox, toutes les 5 minutes)

`mandrix-watchdog.sh` :

- NAS injoignable deux fois de suite : `wake-nas` (Wake-on-LAN) et alerte, puis rappel toutes les heures ; alerte au retour ;
  sauf s'il a été éteint exprès : le marqueur « veille voulue » `/var/lib/nas-power/veille` (posé par `nas-power` du
  homelab, ou par le NAS lui-même à chaque arrêt voulu) coupe le réveil et les alertes jusqu'à `nas-power wake` ;
  rallumé au bouton, le marqueur est retiré au bout de 15 min ;
- NAS éteint : pas de `df` sur son montage NFS « hard » (il resterait bloqué et les `df` s'empileraient) ;
- montage NFS figé (`stat` qui ne répond pas) : alerte ;
- disque du Proxmox, du NAS ou du LXC Mandrix rempli au-delà de 90 % : une alerte par jour ;
- pool LVM « thin » `pve/data` (disques de toutes les VM et conteneurs) rempli au-delà de 85 % (données ou métadonnées) :
  une alerte par jour, et une alerte « critique » à 95 %. Plein, plus aucune VM ne peut écrire ;
- disque du LXC passé en lecture seule (`ro` / `emergency_ro`, après une erreur d'écriture) : alerte, puis toutes les heures
  (si la base ne peut plus écrire, l'alerte peut échouer : elle reste dans le journal) ;
- site public injoignable 10 minutes : si l'app répond en local, le tunnel Cloudflare est redémarré ; sinon toute la pile est relancée.

```bash
install -m 755 deploy/homelab/mandrix-watchdog.sh /usr/local/sbin/mandrix-watchdog
install -m 644 deploy/homelab/mandrix-watchdog.service deploy/homelab/mandrix-watchdog.timer /etc/systemd/system/
printf 'ALERT_TOKEN=%s\n' "<jeton de l'étape 1>" > /etc/mandrix-watchdog.env && chmod 600 /etc/mandrix-watchdog.env
systemctl daemon-reload && systemctl enable --now mandrix-watchdog.timer
```

Réglages facultatifs dans `/etc/mandrix-watchdog.env` : `NAS_IP`, `NAS_MOUNT`, `NAS_SLEEP_FLAG`, `CT`, `APP_LAN`, `PUBLIC_URL`, `DISK_LIMIT`,
`THIN_POOL` (défaut `pve/data`, vide pour ne pas le surveiller), `THIN_LIMIT` (défaut 85).

**Pool LVM presque plein** : `pct exec 107 -- sh -c 'docker builder prune -f && docker image prune -f'`, `pct fstrim <id>`
pour chaque conteneur (rend la place libérée au pool), puis si besoin `lvextend -L +<n>G pve/data` (place libre : `vgs pve`).
**Disque en lecture seule** : libérer ou agrandir le pool d'abord, puis `pct stop 107 && pct fsck 107 --force 1 && pct start 107`.
Journal : `journalctl -t mandrix-watchdog`.

## 2 bis. fstrim hebdomadaire des conteneurs (dimanche 4 h 30)

Un fichier supprimé dans un conteneur (transcodage Plex, téléchargements, construction Docker…) reste compté comme
occupé dans le pool LVM « thin » `pve/data` : Proxmox ne rend pas tout seul cette place. `homelab-fstrim.sh` lance
`pct fstrim --ignore-mountpoints` sur chaque conteneur en marche (repli par `nsenter … fstrim /` quand `pct` refuse,
comme le 105) et note l'état du pool. Ne supprime aucun fichier. Premier passage le 26/11/2026 : 30 Go rendus,
pool de 88 % à 60 %.

```bash
install -m 755 deploy/homelab/homelab-fstrim.sh /usr/local/sbin/homelab-fstrim
install -m 644 deploy/homelab/homelab-fstrim.service deploy/homelab/homelab-fstrim.timer /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now homelab-fstrim.timer
systemctl start homelab-fstrim.service   # passage immédiat
```

Journal : `journalctl -t homelab-fstrim`.

## 3. Restauration test des sauvegardes (chaque lundi à 5 h)

`mandrix-restore-check.sh` restaure la dernière sauvegarde `mandrix-AAAA-MM-JJ.dump` dans une base jetable,
compare le nombre de comptes avec la base réelle, puis supprime la base de test. Alerte si la sauvegarde est
absente, illisible, trop ancienne (plus de 2 jours) ou incomplète.

```bash
install -m 644 deploy/homelab/mandrix-restore-check.service deploy/homelab/mandrix-restore-check.timer /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now mandrix-restore-check.timer
systemctl start mandrix-restore-check.service   # premier essai immédiat
```

Journal : `/var/log/mandrix-restore-check.log` dans le LXC.

## 4. Déploiement automatique (facultatif)

`mandrix-auto-deploy.sh` tourne dans le LXC : toutes les 5 minutes, si `main` a avancé sur GitHub, il copie le
nouveau code dans `/opt/mandrix` et reconstruit. Les PR n'étant fusionnées qu'avec une CI verte, `main` est toujours testée.

Le dépôt est public : le script le récupère en HTTPS, sans clé ni compte GitHub.

```bash
# Dans le LXC 107
apt-get install -y git
install -m 644 /opt/mandrix/deploy/homelab/mandrix-auto-deploy.service /opt/mandrix/deploy/homelab/mandrix-auto-deploy.timer /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now mandrix-auto-deploy.timer
```

Journal : `journalctl -u mandrix-auto-deploy`.

Si le dépôt redevenait privé : créer une clé en lecture seule (`ssh-keygen -t ed25519 -N '' -C mandrix-deploy -f
/root/.ssh/mandrix_deploy`), l'ajouter dans GitHub › Settings › Deploy keys, et passer `REPO=git@github.com:MatteoCnda1/Mandrix.git`
au service ; le script utilise la clé dès qu'elle existe.
