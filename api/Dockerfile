FROM node:24-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY prisma ./prisma
COPY prisma.config.ts tsconfig.json ./
COPY src ./src
RUN DATABASE_URL=postgresql://build:build@localhost/build npm run build

FROM build AS migrate
CMD ["node", "node_modules/prisma/build/index.js", "migrate", "deploy"]

FROM build AS production-deps
RUN npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001
COPY --from=production-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY package.json ./
USER node
EXPOSE 3001
CMD ["node", "dist/server.js"]
