# Déployer Mandrix sur le homelab (Proxmox + NAS UGREEN + Cloudflare Tunnel)

```
 Téléphones / PC ──HTTPS──▶ Cloudflare ──tunnel──▶ VM Proxmox (Docker)
                                                   ├─ app        Fastify + Socket.io + PWA   :3000
                                                   ├─ db         PostgreSQL 17 (disque local de la VM)
                                                   ├─ backup     pg_dump quotidien ─┐
                                                   └─ cloudflared                  │
                                                         │ NFS                     │
                                                         ▼                         ▼
                                                 NAS UGREEN  /mandrix/media   /mandrix/backups
```

- **Photos et vidéos** : écrites directement sur le NAS (partage NFS monté dans la VM).
- **Comptes, posts, messages** (PostgreSQL) : sur le disque local de la VM pour la fiabilité et la vitesse,
  avec **une sauvegarde complète chaque nuit sur le NAS** (14 jours conservés par défaut).
  PostgreSQL directement sur NFS est déconseillé (verrous et coupures réseau peuvent corrompre la base).
- **Accès public** : Cloudflare Tunnel, aucun port à ouvrir sur la box, HTTPS automatique
  (obligatoire pour installer la PWA, utiliser la caméra et recevoir les notifications).

## 1. Préparer le partage sur le NAS UGREEN

1. Dans UGOS Pro, crée un dossier partagé `mandrix` avec deux sous-dossiers : `media` et `backups`.
2. Active le service **NFS** (Panneau de configuration → Services de fichiers → NFS).
3. Dans les autorisations NFS du dossier `mandrix`, autorise l'adresse IP de la VM en **lecture/écriture**.
4. Note le chemin exporté (souvent `/volume1/mandrix`). Depuis la VM, `showmount -e IP_DU_NAS` l'affiche.

## 2. Créer la VM sur Proxmox VE

Recommandé : une VM **Debian 13** (ou Ubuntu 24.04) — 2 vCPU, 2 à 4 Go de RAM, 20 Go de disque (SSD).

```bash
# Dans la VM, en root
apt update && apt install -y git nfs-common curl
curl -fsSL https://get.docker.com | sh
usermod -aG docker <ton-utilisateur>
```

Monte le partage du NAS au démarrage :

```bash
mkdir -p /mnt/nas/mandrix
echo "IP_DU_NAS:/volume1/mandrix  /mnt/nas/mandrix  nfs4  defaults,_netdev,noatime,hard  0 0" >> /etc/fstab
mount -a
mkdir -p /mnt/nas/mandrix/media /mnt/nas/mandrix/backups
chown -R 1000:1000 /mnt/nas/mandrix   # uid/gid utilisés par le conteneur (APP_UID/APP_GID)
```

> Si le NAS « écrase » les utilisateurs NFS (squash), règle `APP_UID`/`APP_GID` dans `.env`
> sur l'uid/gid vers lequel il les mappe, ou choisis « pas de mappage » pour l'IP de la VM.

<details>
<summary>Variante : conteneur LXC au lieu d'une VM</summary>

Un LXC Debian fonctionne aussi (options **nesting** et **keyctl** activées pour Docker).
Le plus simple est de monter le NFS sur l'hôte Proxmox (Datacenter → Stockage → Ajouter → NFS),
puis de le passer au conteneur : `pct set <ID> -mp0 /mnt/pve/<stockage>,mp=/mnt/nas/mandrix`.
Dans un LXC non privilégié, l'uid 1000 du conteneur correspond à l'uid 101000 sur l'hôte :
adapte les droits du dossier en conséquence.
</details>

## 3. Installer Mandrix

```bash
git clone https://github.com/MatteoCnda1/Mandrix.git
cd Mandrix
cp .env.example .env
nano .env    # APP_URL, POSTGRES_PASSWORD, MEDIA_PATH, BACKUP_PATH, INVITE_CODE…
docker compose up -d --build
```

Vérifie sur le réseau local : `http://IP_DE_LA_VM:3000` (la caméra et l'installation de la PWA
ne fonctionnent qu'en HTTPS : utilise l'adresse du tunnel pour un vrai test).

## 4. Ouvrir l'accès avec Cloudflare Tunnel

1. Tableau de bord Cloudflare → **Zero Trust → Networks → Tunnels → Create a tunnel** (type *Cloudflared*).
2. Copie le **token** affiché et colle-le dans `.env` : `CLOUDFLARE_TUNNEL_TOKEN=...`
3. Dans l'onglet **Public Hostname** du tunnel : `mandrix.tondomaine.fr` → service `HTTP` → URL `app:3000`.
4. Démarre le tunnel :

```bash
docker compose --profile tunnel up -d
```

Les WebSockets (jeu en temps réel, messages) passent par le tunnel sans réglage supplémentaire.
Le plan gratuit limite chaque envoi à 100 Mo, d'où `MAX_UPLOAD_MB=100`.

## 5. Premier compte et administration

- Le **premier compte créé** sur l'instance devient administrateur (modération du pool).
  Les e-mails listés dans `ADMIN_EMAILS` le deviennent aussi à l'inscription.
- Avec `INVITE_CODE` défini, il faut ce code pour s'inscrire : donne-le seulement à tes amis.

Commandes utiles :

```bash
docker compose exec app node server/dist/cli.js users                      # liste des comptes
docker compose exec app node server/dist/cli.js make-admin <pseudo|email>  # promouvoir un admin
docker compose exec app node server/dist/cli.js reset-password <pseudo|email> [nouveau-mdp]
docker compose logs -f app                                                 # journaux
```

## 6. Sauvegardes et restauration

- Le service `backup` écrit `mandrix-AAAA-MM-JJ.dump` chaque jour dans `BACKUP_PATH` (sur le NAS).
- Les médias sont déjà sur le NAS : pense à inclure le dossier `mandrix` dans les sauvegardes/instantanés du NAS.
- Sauvegarde aussi la VM elle-même avec Proxmox (Datacenter → Sauvegarde, vers le NAS ou un PBS).

Restaurer une sauvegarde :

```bash
docker compose stop app
docker compose exec -T db pg_restore -U mandrix -d mandrix --clean --if-exists < /mnt/nas/mandrix/backups/mandrix-2026-11-23.dump
docker compose start app
```

## 7. Mettre à jour

```bash
cd Mandrix
git pull
docker compose up -d --build
```

Les migrations de base de données s'appliquent automatiquement au démarrage.

## 8. Notifications push

- Les clés VAPID sont générées au premier démarrage et conservées en base : rien à configurer.
- **Android / ordinateur** : chaque utilisateur active les notifications dans *Profil → Notifications push*.
- **iPhone (iOS 16.4+)** : il faut d'abord ajouter Mandrix à l'écran d'accueil (Safari → Partager →
  « Sur l'écran d'accueil »), l'ouvrir depuis l'icône, puis activer les notifications dans le profil.
