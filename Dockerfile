# syntax=docker/dockerfile:1
# Image unique : API Fastify + Socket.io qui sert aussi la PWA compilée.

# ——— 1. Compilation (front + serveur) ———
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# ——— 2. Dépendances de production du serveur uniquement ———
FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev --workspace=server --include-workspace-root=false --no-audit --no-fund

# ——— 3. Image finale ———
FROM node:24-slim
# ffmpeg : transcodage des vidéos (HEVC d'iPhone → H.264) et miniatures.
RUN apt-get update \
  && apt-get install -y --no-install-recommends tzdata ffmpeg \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    TZ=Europe/Paris \
    PORT=3000 \
    DATA_DIR=/data \
    WEB_DIST=/app/web/dist \
    MIGRATIONS_DIR=/app/server/drizzle
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/server/package.json ./server/
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/drizzle ./server/drizzle
COPY --from=build /app/web/dist ./web/dist
RUN mkdir -p /data/media && chown -R node:node /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/dist/index.js"]
