# Claudstermind online relay — the containerized public gateway.
#
# Build context is the Claudstermind ROOT (it needs lib/ + dashboard/), so build with:
#   docker build -f relay/Dockerfile -t claudstermind-relay .
# or let docker-compose.yml (context: ..) do it.
FROM node:24-alpine

WORKDIR /app

# Dependencies first, for layer caching. The relay's manifest declares jose + ws; installing
# it at /app puts node_modules where BOTH the relay (ws) and the reused auth modules (jose)
# resolve it by walking up from their directories.
COPY relay/package.json ./package.json
RUN npm install --omit=dev && npm cache clean --force

# Application code — only what the relay actually imports (relay-core needs lib/protocol,
# the auth modules + jose, and the static UI). Nothing else of the workspace ships.
COPY lib/protocol.mjs ./lib/protocol.mjs
COPY dashboard/auth/ ./dashboard/auth/
COPY dashboard/public/ ./dashboard/public/
COPY relay/ ./relay/

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0

# /api/me is public and cheap — a good liveness probe.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+ (process.env.PORT||8080) +'/api/me').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

USER node
EXPOSE 8080
CMD ["node", "relay/server.mjs"]
