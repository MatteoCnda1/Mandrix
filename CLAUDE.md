# Mandrix

PWA sociale privée entre amis, auto-hébergée sur un homelab. Contexte complet (fonctionnalités, production, décisions, pièges) : [docs/CONTEXTE.md](docs/CONTEXTE.md).

- Monorepo npm : `shared/` (types d'API), `server/` (Fastify + Socket.io + Drizzle + PostgreSQL), `web/` (React + Vite + Tailwind 4, PWA).
- Avant de proposer une PR : `npm run typecheck` et `npm test` (PostgreSQL de dev : `npm run db:up`).
- Schéma modifié → `npm run db:generate` et commiter la migration de `server/drizzle/`.
- Interface en français, Apple HIG, briques communes dans `web/src/components/ui.tsx`.
- Merge des PR à la main une fois la CI verte (pas d'auto-merge sur ce dépôt), puis redéploiement de `main` (voir docs/CONTEXTE.md §5).
- Ne jamais commiter ni afficher les secrets du `.env` de production.
