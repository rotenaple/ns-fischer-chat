# Multi-stage Dockerfile
FROM node:20-alpine AS builder
WORKDIR /app

# Copy package files and lockfile, then install dependencies
COPY package*.json ./
RUN npm config set cache /tmp/.npm-cache --global \
 && npm ci --omit=dev --no-audit --no-fund --no-optional --unsafe-perm --silent \
 && npm cache clean --force || true \
 && rm -rf /tmp/.npm-cache || true

# Final stage: assemble runtime image
FROM node:20-alpine

# Install dumb-init for proper signal handling
RUN apk update && apk upgrade && apk add --no-cache dumb-init && rm -rf /var/cache/apk/*

# Create non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001 -G nodejs

WORKDIR /app

# Copy installed node_modules from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy application files
COPY --chown=nodejs:nodejs src/ ./src/
COPY --chown=nodejs:nodejs package*.json ./

# Create data directory for state persistence
RUN mkdir -p /app/data && chown -R nodejs:nodejs /app

# Environment
ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "console.log('Health check passed')" || exit 1

USER nodejs

CMD ["node", "src/index.js"]
