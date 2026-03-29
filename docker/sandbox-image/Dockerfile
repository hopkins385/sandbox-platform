# Stage 1: build agent-worker
FROM node:24-slim AS worker-builder
WORKDIR /build
RUN npm install -g pnpm
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/agent-worker ./packages/agent-worker
COPY packages/logger ./packages/logger
COPY packages/nuxt-starter ./packages/nuxt-starter
COPY packages/shared-types ./packages/shared-types
COPY packages/tsconfig ./packages/tsconfig
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @sandbox/logger build
RUN pnpm --filter @sandbox/agent-worker build
RUN pnpm deploy --filter @sandbox/agent-worker --prod --legacy /build/agent-worker-deploy
RUN pnpm deploy --filter @sandbox/nuxt-starter --prod --legacy /build/nuxt-starter-deploy

# Stage 2: runtime image
FROM node:24-slim

RUN apt-get update && apt-get install -y \
    git \
    curl \
    jq \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm

# Install Playwright system deps + Chromium for MCP browser agent
RUN npx playwright install-deps chromium \
    && npx playwright install chromium

# Install agent-worker
COPY --from=worker-builder /build/agent-worker-deploy /usr/local/lib/agent-worker

# Install nuxt-starter template
COPY --from=worker-builder /build/nuxt-starter-deploy /opt/nuxt-starter

# Install init script
COPY docker/sandbox-image/scripts/init-app.sh /usr/local/bin/init-app.sh
RUN chmod +x /usr/local/bin/init-app.sh

# Create non-root user
RUN useradd -m -s /bin/bash sandbox
RUN mkdir -p /app && chown sandbox:sandbox /app

USER sandbox
WORKDIR /app

EXPOSE 3000
EXPOSE 4001

ENTRYPOINT ["/usr/local/bin/init-app.sh"]
