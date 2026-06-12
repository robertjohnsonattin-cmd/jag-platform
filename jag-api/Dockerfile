# ── JAG API Dockerfile ────────────────────────────────────────────────────────
#
# Pre-built pattern — both the TypeScript compilation AND the production
# node_modules are built on the host before `docker compose build`.
#
# Root cause for host-build requirement: npm 11 (Windows host) generates a
# lockfileVersion 3 that causes npm 10 (Alpine container) to silently fail to
# extract package tarballs, producing empty package directories.
#
# Deploy gate (STD-12 — run BEFORE docker compose build):
#   cd jag-api
#   npm run build:prod          # compile TypeScript → dist/
#   node scripts/prod-install.js  # install prod-only node_modules → prod_modules/
#
# For development:  npm ci && npm run build && npm test (all run on the host)
# For Docker image: only dist/ and prod_modules/ are COPY'd in

FROM node:20-alpine

WORKDIR /app

# Copy package manifests for reference (not used for install)
COPY package.json ./

# Copy pre-built TypeScript output
# --chown ensures the node user owns all files regardless of host permissions
COPY --chown=node:node dist ./dist

# Copy pre-installed production node_modules from host.
# All production dependencies (dotenv, express, jose, pg, zod) are pure JS —
# no native addons — so Windows-built node_modules run on Alpine without issue.
COPY --chown=node:node prod_modules/node_modules ./node_modules

# Never run as root
USER node

EXPOSE 3000

ENV NODE_ENV=production \
    PORT=3000

HEALTHCHECK --interval=30s --timeout=15s --start-period=45s --retries=5 \
  CMD wget -qO- http://localhost:3000/health/ready || exit 1

CMD ["node", "dist/index.js"]
