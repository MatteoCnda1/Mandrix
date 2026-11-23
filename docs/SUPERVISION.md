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
- montage NFS figé (`stat` qui ne répond pas) : alerte ;
- disque du Proxmox ou du NAS rempli au-delà de 90 % : une alerte par jour ;
- site public injoignable 10 minutes : si l'app répond en local, le tunnel Cloudflare est redémarré ; sinon toute la pile est relancée.

```bash
install -m 755 deploy/homelab/mandrix-watchdog.sh /usr/local/sbin/mandrix-watchdog
install -m 644 deploy/homelab/mandrix-watchdog.service deploy/homelab/mandrix-watchdog.timer /etc/systemd/system/
printf 'ALERT_TOKEN=%s\n' "<jeton de l'étape 1>" > /etc/mandrix-watchdog.env && chmod 600 /etc/mandrix-watchdog.env
systemctl daemon-reload && systemctl enable --now mandrix-watchdog.timer
```

Réglages facultatifs dans `/etc/mandrix-watchdog.env` : `NAS_IP`, `NAS_MOUNT`, `CT`, `APP_LAN`, `PUBLIC_URL`, `DISK_LIMIT`.
Journal : `journalctl -t mandrix-watchdog`.

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

Le dépôt est privé : il faut une **clé de déploiement en lecture seule**, à créer par le propriétaire du dépôt.

```bash
# Dans le LXC 107
ssh-keygen -t ed25519 -N '' -C mandrix-deploy -f /root/.ssh/mandrix_deploy
cat /root/.ssh/mandrix_deploy.pub
# → GitHub, dépôt Mandrix › Settings › Deploy keys › Add deploy key (lecture seule)
install -m 644 /opt/mandrix/deploy/homelab/mandrix-auto-deploy.service /opt/mandrix/deploy/homelab/mandrix-auto-deploy.timer /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now mandrix-auto-deploy.timer
```

Journal : `journalctl -u mandrix-auto-deploy`.
