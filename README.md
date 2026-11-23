# Mandrix

Poste, vote et joue avec tes amis. Chaque dimanche à 20h, tout le monde déballe les photos de la semaine.

PWA sociale auto-hébergée (homelab Proxmox + NAS), installable sur téléphone, avec notifications push.

## Fonctionnalités

| Écran | Contenu |
| --- | --- |
| **Fil** | Stories 24 h, photos, vidéos, sondages (choix, photos, curseur emoji), j'aime, commentaires, republication |
| **Reels** | Vidéos verticales en plein écran, défilement tactile / molette / clavier |
| **La Pellicule** | Appareil photo intégré : les photos restent scellées (même pour leur auteur) jusqu'au dimanche 20h, série de semaines |
| **Déballage** | Ouverture des photos de la semaine (cartes qui se retournent), récap du top 3, envoi dans le pool |
| **Make It Friends** | Jeu multijoueur temps réel (2 à 8) : une image tirée du pool, une légende, tout le monde vote |
| **Galerie des mèmes** | Podium des mèmes les plus aimés |
| **Profil** | Statistiques, série, amis, mode sombre, notifications push, installation, modération (admin) |
| **Messages** | Discussions privées entre amis, réponses aux stories, invitations aux salons |

## Stack

- **Front** : React 19, Vite 7, TypeScript, Tailwind CSS 4, TanStack Query, Zustand, `vite-plugin-pwa` (Workbox)
- **Back** : Node 24, Fastify 5, Socket.io 4, Drizzle ORM, PostgreSQL 17, sharp (images), web-push
- **Déploiement** : Docker Compose sur une VM Proxmox, médias et sauvegardes sur le NAS (NFS), Cloudflare Tunnel

## Structure

```
shared/   types et constantes communs (API, jeu, notifications)
server/   API REST + Socket.io + tâches planifiées (déballage, rappels, ménage)
  src/routes/      auth, utilisateurs/amis, posts, stories, pool, pellicule, messages, notifications, médias
  src/realtime/    moteur du jeu Make It Friends
  drizzle/         migrations SQL
web/      PWA React
  src/screens/     écrans de la maquette
  src/sheets/      feuilles du bas (composer, commentaires, pool, stories, amis…)
  src/sw.ts        service worker (cache hors ligne, notifications push)
docs/     guide de déploiement
```

La maquette d'origine est conservée dans `Mandrix.dc.html`.

## Développement

Prérequis : Node 22+, Docker.

```bash
npm install
npm run db:up      # PostgreSQL de dev sur le port 5433
npm run dev        # API sur :3000 + PWA sur http://localhost:5173
```

Le premier compte créé est administrateur. Autres commandes :

```bash
npm run typecheck                       # vérification TypeScript (serveur + PWA)
npm run build                           # build de production
npm run db:generate                     # nouvelle migration après modification de server/src/db/schema.ts
npm run icons                           # régénère les icônes PWA depuis la mascotte
npm run cli -w server -- make-admin <pseudo>
```

## Déploiement

Voir [docs/DEPLOIEMENT.md](docs/DEPLOIEMENT.md) (Proxmox, NAS UGREEN en NFS, Cloudflare Tunnel, sauvegardes).
