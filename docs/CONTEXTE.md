# Mandrix — contexte du projet

Ce document résume tout ce qui a été construit, comment c'est déployé et les décisions prises en route.
À lire avant de reprendre le projet (humain ou agent). Le README couvre l'installation ; ici, c'est le « pourquoi » et le « où ».

> Dernière mise à jour : 23 novembre 2026 (issues #5 à #18).

## 1. L'idée

Mandrix est un réseau social **privé**, entre amis, installé en PWA sur le téléphone.
On y poste, on vote, on joue ; et toute la semaine, on prend des photos avec **La Pellicule**,
qui restent scellées (même pour leur auteur) jusqu'au **dimanche 20h**, heure du **Déballage** collectif.

- Public : le propriétaire du projet et ses amis. Le site n'est pas ouvert au public : pas de démarche RGPD.
- Inscription uniquement sur **parrainage** (code personnel dans le profil, lien `/?parrain=CODE`).
- Maquette d'origine : `Mandrix.dc.html` (Landing, Fil, Reels, Make It Friends, Galerie des mèmes, Pellicule, Déballage, Profil, Messages, notifications).

## 2. Choix techniques

| Sujet | Choix | Raison |
| --- | --- | --- |
| Front | React 19 + Vite 7 + TypeScript + Tailwind CSS 4 | PWA installable, rapide à itérer |
| État | TanStack Query 5 (serveur), Zustand 5 (local) | cache + invalidations par socket |
| Back | Node 24, Fastify 5, Socket.io 4, Drizzle ORM, zod | une seule app, temps réel pour le jeu et les messages |
| Base | PostgreSQL 17 | relations (amis, votes, groupes) |
| Médias | sharp (WebP), ffmpeg (H.264, AAC, miniatures) | lisible partout, iPhone compris |
| Auth | e-mail + mot de passe (argon2), cookie de session `mdx_session` (hash sha256 en base) | simple, sans service tiers |
| Notifications | Web Push (VAPID) | marche sur iOS une fois la PWA installée |
| Hébergement | **tout en local** sur le homelab (Proxmox + NAS UGREEN), exposé par Cloudflare Tunnel | aucun backend managé |
| Design | ambiance « Aurore » (dégradés animés), cartes en verre, barre d'onglets iOS, Apple HIG | choisi parmi plusieurs propositions |

## 3. Organisation du dépôt

Monorepo npm workspaces :

```
shared/   types d'API et constantes partagés (MediaRef, Post, Message, Conversation, jeu, notifications…)
server/   API Fastify + Socket.io + tâches planifiées
  src/app.ts         construction de l'app (cookies, rate-limit, multipart, statique, SPA, sockets)
  src/env.ts         toutes les variables d'environnement
  src/db/schema.ts   schéma Drizzle ; migrations SQL dans server/drizzle/
  src/routes/        auth, users/amis, posts, stories, pool, pellicule, messages, notifications, media
  src/realtime/      socket (auth par cookie + contrôle d'origine), moteur Make It Friends (salons en mémoire)
  src/lib/           media (upload), video (file de transcodage), moment, invite, push, mail
  src/jobs.ts        tâches croner : déballage du dimanche, rappel du samedi, Moment Mandrix, ménage nocturne
  test/              tests d'API Vitest (base mandrix_test)
web/      PWA React
  src/screens/       Feed, Reels, Game, Memes, Camera (Pellicule), Unpack (Déballage), Profile, Messages, Landing
  src/sheets/        feuilles du bas : Composer, Comments, Pool, StoryViewer, Friends, NewMessage, Invite, Install…
  src/components/    ui.tsx (briques communes), AppLayout, PostCard, ChatMedia, Notifications, UpdateBanner
  src/lib/           api, socket, store, push, keyboard, pelliculeQueue, recorder, hooks
  src/sw.ts          service worker (precache, navigation hors ligne, cache photos, push, Background Sync)
docs/     DEPLOIEMENT.md (guide générique), logo/ (masters SVG), ce fichier
```

## 4. Fonctionnalités en place

### Fil, stories, sondages
- Posts photo/vidéo/texte, j'aime, commentaires (avec j'aime), republication.
- **Réactions emoji** (#5) : tap sur le cœur = j'aime, appui long = 😂 😍 😮 😢 🔥 👏 (une par personne, notification regroupée par post).
- **@mentions et #hashtags** (#6) : suggestions d'amis en tapant « @ », notification aux amis mentionnés qui voient le post, hashtags cliquables vers la recherche.
- Sondages : choix (jusqu'à **6 options**), photos, curseur emoji ; **durée** (1 h, 24 h, 3 jours, sans fin), **votes publics** facultatifs, vote bloqué côté serveur à la fin et résultat envoyé à l'auteur (#7).
- **Recherche** `/recherche` (#13) : légendes, options de sondage et mèmes du cercle, `#hashtag` exact, personnes ; « Tu les connais peut-être ? » (amis d'amis par amis en commun).
- Stories 24 h avec **aperçu de la story** dans la tuile du fil, vues, réponses.
- Répondre à une story envoie un message privé qui **affiche la photo de la story** des deux côtés (instantané dans `messages.meta`).
- Tirer pour rafraîchir.

### Reels
Vidéos verticales plein écran, défilement tactile, molette et clavier.

### Vidéos (issue #1)
Toute vidéo envoyée passe par une **file de transcodage** (une à la fois pour ménager le CPU) :
H.264 720p max, 30 i/s (`-fpsmax 30`), AAC, `+faststart`, miniature WebP, durée.
Statut `processing → ready | failed` (en cas d'échec on garde l'original). Le socket `media:ready` rafraîchit l'interface.
La file reprend au démarrage (`resumeVideoQueue`).

### La Pellicule et le Déballage (issues #2, #3, #4)
- Photos scellées via `media.sealed_until` jusqu'au prochain dimanche 20h (fuseau `Europe/Paris`).
- **Hors ligne** : file IndexedDB + Background Sync (`pellicule-upload`), dédoublonnage par `clientId`, heure de prise `takenAt`.
- **Moment Mandrix** : chaque jour, à une heure aléatoire (`MOMENT_START_HOUR`–`MOMENT_END_HOUR`), notification ; 10 minutes pour prendre la photo, badge « pile à l'heure » (`on_time`).
- Série de semaines, rappel du samedi.
- Déballage : cartes qui se retournent, top 3, rétrospective animée, album zip (`/api/pellicule/archive?scope=mine|all`).

### Make It Friends
Jeu temps réel 2 à 8 joueurs : une image tirée du pool, chacun écrit une légende, tout le monde vote.
Salons en mémoire, codes `MDRX-###`, invitations par message, pool d'images partagé (signalements, modération admin),
podium avec départage par auteur en cas d'égalité. Correctif : la création de salon diffuse maintenant l'état (#20).

**Mème du jour** (#9, onglet du jeu `/jeu?onglet=jour`) : une image du pool public tirée à 8 h (heure de Paris), une légende
par personne modifiable jusqu'à 18 h, votes anonymes de 18 h à minuit, résultats le lendemain. Chaque vote vaut 50 points,
le gagnant +100. Les légendes rejoignent la table `memes`.

### Galerie des mèmes
Classement de la **saison** (mois en cours : somme des `memes.score`, parties et mèmes du jour), champions des mois passés,
puis podium des mèmes les plus aimés.

### Messages
- Conversations privées et **groupes** (jusqu'à `GROUP_MAX_MEMBERS`) : création, renommage, ajout de membres, quitter ; messages système.
- Non-lus, badges, push.
- **Répondre à un message** : glisser la bulle vers la droite (ou appui long › Répondre) ; citation figée dans `messages.meta` (`type: 'reply'`).
- **« … écrit »** (socket `dm:typing`, expire après 6 s), **accusés « Vu » / « Vu par … »** (`dm:read`, table `conversation_reads`),
  **réactions** par appui long sur une bulle (❤️ + les six emoji), avec « Copier » et « Signaler ».
- Chat plein écran sur téléphone ; le clavier ne fait plus remonter tout l'écran (variables `--vvh`, `--kb` via `visualViewport`).
- Barre de défilement masquée dans les conversations.
- **Photos, vidéos et vocaux** (branche `feat/messages-media`) :
  - trombone → photo ou vidéo (aperçu, texte facultatif, progression d'envoi) ; vidéos transcodées comme ailleurs ;
  - micro (quand le champ est vide) → enregistrement `MediaRecorder` (5 min max, niveau sonore animé, annuler/envoyer) ;
  - le serveur convertit chaque vocal en **AAC mono .m4a** (Safari enregistre en AAC, Chrome/Firefox en Opus : l'AAC se lit partout) ;
  - bulles : lecteur vocal avec forme d'onde et saut, miniature photo/vidéo, visionneuse plein écran ;
  - aperçu dans la liste et dans les push : « 📷 Photo », « 🎥 Vidéo », « 🎤 Message vocal (0:12) » (`attachmentLabel` dans `shared`).

### Profil et compte
Statistiques, série, amis, code de parrainage (`InviteCard`), mode sombre, installation guidée, modération (admin).

**Réglages** `/reglages` :
- notifications par catégorie, en push et dans la cloche, et **heures calmes** (#12) ; appliquées côté serveur (`notify`, `sendPush(…, kind)`) ;
- **ambiance** de fond (#14) : Aurore, Ciel vivant, Doodles & grain, Heure réelle (doré le dimanche 19 h–21 h), mémorisée par appareil, figée par « Réduire les animations » ;
- **compte** (#11) : e-mail, mot de passe (ferme les autres sessions), appareils connectés, export zip (JSON + médias), suppression (cascade + fichiers) ;
- comptes bloqués.

**Blocage et signalements** (#10) : bloquer retire l'amitié et coupe profil, recherche, demandes et messages à deux.
Signaler un post, commentaire, story, message ou compte ; trois signalements masquent le contenu. L'admin a une file
de modération (classer, masquer, supprimer) et peut **suspendre** un compte (connexion refusée).
Le **premier compte créé est administrateur** (et `ADMIN_EMAILS`, `npm run cli -w server -- make-admin <pseudo>`).

### PWA
- Zoom au pincement et au double tap désactivés (Safari ignore `user-scalable=no` : les évènements de geste sont annulés).
- Écrans et feuilles chargés à la demande (`React.lazy`) : JS initial ≈ 186 Ko compressés (#15).
- Photos : variantes WebP 360/720/1280 générées à l'envoi (rattrapage au démarrage), servies en `?w=` via `srcset` (#15).
- Accessibilité (#16) : tailles de texte en `rem`, texte secondaire et liens ≥ 4,5:1, focus gardé dans les feuilles.
- Mise à jour sur demande : bannière « Mettre à jour » (`registerType: 'prompt'`, message `SKIP_WAITING`).
- Overlays rendus dans un portail (`Portal`) pour passer au-dessus de la barre d'onglets.
- Icônes générées depuis les masters du logo (`npm run icons`, logo « mandrill pensif low poly » de Solal, #19).
- **Les URL des icônes portent une empreinte** `?v=<hash>` (manifeste, apple-touch-icon, favicon, calculée dans `web/vite.config.ts`) :
  iOS, Android et Cloudflare (qui garde les PNG 4 h) cachent les icônes par URL, donc changer le logo change l'URL.
  Sur iOS, il faut quand même supprimer l'ancienne icône de l'écran d'accueil puis réinstaller depuis Safari.

## 5. Production (homelab)

| Élément | Valeur |
| --- | --- |
| URL publique | https://mandrix.rudylink.eu (Cloudflare Tunnel → `http://app:3000`) |
| Hôte | Proxmox VE `pve`, accès SSH via Tailscale (validation « check » faite par le propriétaire dans le navigateur) |
| Conteneur | LXC 107 « mandrix », IP LAN 192.168.1.116, code dans `/opt/mandrix` |
| Pile | `docker compose` : `app`, `db` (PostgreSQL, données sur le rootfs du LXC), `backup` (dumps quotidiens), `cloudflared` (profil `tunnel`) |
| Stockage | NAS UGREEN 192.168.1.78, export NFSv3 `/volume1/media` → `/mnt/nas` sur pve → `/mnt/nas/mandrix` monté en `/srv/mandrix` (media/ + backups/) |
| Droits | le NAS écrase root : écritures en uid 1000, d'où l'`lxc.idmap` 1000 → 1000 (comme le LXC 103) |
| Réveil du NAS | `ssh pve wake-nas` (Wake-on-LAN). Si le NAS tombe, `/mnt/nas` se fige et des `df` s'empilent (charge ~290 observée) |

Secrets : le mot de passe PostgreSQL et le jeton du tunnel Cloudflare sont **uniquement** dans le `.env` du serveur. Ne jamais les commiter ni les afficher.

**Déployer** (le dépôt GitHub est privé, pas de `git clone` sur le serveur) :

```bash
git archive --format=tar main | gzip | ssh pve 'cat > /tmp/mandrix-src.tgz \
  && pct push 107 /tmp/mandrix-src.tgz /tmp/mandrix-src.tgz \
  && pct exec 107 -- tar -xzf /tmp/mandrix-src.tgz -C /opt/mandrix \
  && rm -f /tmp/mandrix-src.tgz \
  && pct exec 107 -- sh -c "cd /opt/mandrix && docker compose up -d --build"'
```

Puis vérifier : `/api/config` répond, les fichiers servis correspondent au build (comparaison md5), le NAS est joignable.

**Supervision** (#18) : watchdog NAS/disque/site sur le Proxmox, restauration test hebdomadaire des sauvegardes,
déploiement automatique facultatif (clé de déploiement GitHub), alertes en push chez les admins. Voir [SUPERVISION.md](SUPERVISION.md).

## 6. Qualité et flux de travail

- **CI GitHub Actions** (`.github/workflows/ci.yml`) sur `main` et chaque PR : types (serveur + PWA), tests d'API Vitest sur PostgreSQL 17 + ffmpeg, build, image Docker.
- Tests : `server/test/` (auth, posts, pellicule, messages, vidéo, jeu). Helpers : `useApp`, `resetDb`, `register`, `makeUser`, `befriend`, `upload`, `jpeg`.
- Branches + PR, puis **merge manuel une fois la CI verte** : GitHub refuse l'auto-merge sur ce dépôt privé (offre gratuite). Ensuite on redéploie `main`.
- Un collaborateur (Solal-Kruczynski) ouvre aussi des PR (logo #19).
- Commits en français, messages descriptifs.

## 7. Pièges déjà rencontrés

- Dates dans du SQL brut (`sql\`\``) : passer `date.toISOString()` avec `::timestamptz`, pas un objet `Date`.
- `cx()` utilise `tailwind-merge` pour que la dernière classe gagne.
- Le CSS global doit rester dans `@layer base`, sinon il écrase les utilitaires Tailwind.
- Le fond Aurore est sur `<html>` ; un fond sur `<body>` le masque.
- Un parent animé crée un contexte d'empilement : les feuilles et visionneuses passent par `Portal`.
- `@fastify/static` : `cacheControl: false` puis en-têtes à la main (`/assets/` immuable, le reste `no-cache`) ; `HEAD /` doit répondre.
- Le serveur de dev doit écouter sur 3000 (`PORT=3000 tsx watch …`), Vite sur 5173 avec proxy.
- Tests d'auth : `env.inviteCode = null` pour tester le parrainage seul.
- **Retour arrière** : jamais `navigate('/chemin')` pour un bouton retour (ça empile une page et crée des boucles).
  Utiliser `useGoBack()` (`web/src/lib/nav.ts`) : recule si la page visée est la précédente, sinon remplace.
- **Blocage du défilement** : toujours `lockScroll()` / `useScrollLock()` (`web/src/lib/scrollLock.ts`, compté), jamais
  `body.style.overflow` à la main (deux calques fermés ensemble laissaient la page bloquée).
- **Calques** : visionneuses z-45/55, feuilles z-62, menus d'appui long z-70, confirmations z-80, messages z-85.
- **Gestes** : `web/src/lib/gestures.ts` (glisser, maintenir, double tap) et `Zoomable.tsx` (pincer pour zoomer) ;
  le zoom de la page reste bloqué. Glisser depuis le bord gauche = retour, seulement dans la PWA iOS.
- **Stories** : le visionneur fige la liste à l'ouverture ; le minuteur cumule le temps écoulé par story.
- Heure de Paris : `Intl` en `en-GB` + `formatToParts` (le format français écrit « 15 h », `Number()` donne NaN).
- Un `<span>` interrupteur dans un bouton non flex reste en ligne : `Switch` est `inline-block`.
- `gh pr update-branch` n'existe pas ici : `gh api -X PUT repos/MatteoCnda1/Mandrix/pulls/<n>/update-branch`.

## 8. Migrations

| Fichier | Contenu |
| --- | --- |
| `0000_init` | schéma de base |
| `0001_referral` | codes de parrainage (`invite_code`, `invited_by`) |
| `0002_video_offline_moment` | statut/miniature/durée des vidéos, `client_id`/`taken_at`/`on_time` des photos, Moment Mandrix |
| `0003_group_chats` | groupes (`conversation_members`, `is_group`, `title`), rattrapage des membres existants |
| `0004_message_media` | `messages.media_id` (pièce jointe, `ON DELETE SET NULL`) |
| `0005_reactions_moderation_daily` | réactions (posts, messages), blocages, signalements, `hidden_at`, suspension, préférences de notifications, sessions (appareil, activité), sondages (fin, public), variantes de photos, mème du jour |

## 9. Pistes ouvertes

Les issues #1 à #18 sont traitées. Restent à faire à la main : l'audit VoiceOver / TalkBack sur téléphone (#16) et,
pour le déploiement automatique (#18), la clé de déploiement GitHub en lecture seule (voir SUPERVISION.md).
