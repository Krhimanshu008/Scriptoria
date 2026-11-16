# ==============================================================================
# Stage 1: Dependencies Cache
# ==============================================================================
FROM node:20-bookworm-slim AS deps
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
COPY prisma ./prisma/
RUN npm ci

# ==============================================================================
# Stage 2: Production Builder
# ==============================================================================
FROM node:20-bookworm-slim AS builder
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# Generate Prisma client and compile Next.js standalone bundle
RUN npx prisma generate
RUN npm run build

# ==============================================================================
# Stage 3: Minimal Production Runner
# ==============================================================================
FROM node:20-bookworm-slim AS runner
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Persistent database storage mount point
RUN mkdir -p /app/data && chown -R node:node /app

# Copy standalone build artifacts from builder
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/prisma ./prisma
COPY --chown=node:node ws-proxy.js ./ws-proxy.js
COPY --chown=node:node docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

USER node

EXPOSE 3000

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "server.js"]
