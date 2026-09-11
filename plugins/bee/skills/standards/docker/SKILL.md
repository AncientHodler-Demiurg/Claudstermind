---
name: docker
description: "Docker and containerization standards -- Dockerfile, docker-compose, multi-stage builds, production patterns. Use when project has Dockerfile or docker-compose.yml."
---

# Docker Standards

**Detection:** Check for `Dockerfile`, `docker-compose.yml`, or `docker-compose.yaml` at project root. If absent, skip.

## Dockerfile Best Practices

### Multi-stage Build (Node.js)

```dockerfile
# Stage 1: Dependencies
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

# Stage 2: Build
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

# Stage 3: Production
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 app && adduser --system --uid 1001 app
COPY --from=builder --chown=app:app /app/dist ./dist
COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/package.json ./
USER app
EXPOSE 3000
CMD ["node", "dist/main.js"]
```

### Multi-stage Build (Laravel)

```dockerfile
FROM php:8.4-fpm-alpine AS base
RUN apk add --no-cache libpq-dev && docker-php-ext-install pdo_pgsql opcache
COPY --from=composer:latest /usr/bin/composer /usr/bin/composer

FROM base AS deps
WORKDIR /app
COPY composer.json composer.lock ./
RUN composer install --no-dev --no-scripts --prefer-dist

FROM node:22-alpine AS frontend
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM base AS runner
WORKDIR /app
COPY --from=deps /app/vendor ./vendor
COPY --from=frontend /app/public/build ./public/build
COPY . .
RUN php artisan config:cache && php artisan route:cache && php artisan view:cache
EXPOSE 9000
CMD ["php-fpm"]
```

### Rules

- Always use multi-stage builds — separate deps, build, runtime
- Use specific Alpine tags (`node:22-alpine`), never `latest`
- Run as non-root user in production (`USER app`)
- Copy `package.json`/`lock` before source code — leverages Docker layer caching
- Use `--frozen-lockfile` for reproducible builds
- Set `NODE_ENV=production` in runtime stage
- `.dockerignore` must exclude: `node_modules`, `.git`, `.env`, `dist`, `.next`

## Docker Compose

```yaml
# docker-compose.yml
services:
  app:
    build:
      context: .
      target: runner
    ports:
      - "3000:3000"
    env_file: .env
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_started

  db:
    image: postgres:17-alpine
    volumes:
      - pgdata:/var/lib/postgresql/data
    environment:
      POSTGRES_DB: app
      POSTGRES_USER: app
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app"]
      interval: 5s
      timeout: 3s
      retries: 5

  redis:
    image: redis:7-alpine
    volumes:
      - redisdata:/data

volumes:
  pgdata:
  redisdata:
```

### Compose Rules

- Use `depends_on` with `condition: service_healthy` for databases
- Use named volumes for data persistence — never bind mounts in production
- Use `.env` file for secrets — never hardcode passwords in compose file
- Separate `docker-compose.override.yml` for dev-specific config (port mappings, volume mounts, hot reload)

## Common Pitfalls

- **No `.dockerignore`** — copying `node_modules` into build context makes builds 10x slower
- **Running as root** — security risk. Always add non-root user.
- **`latest` tag** — non-reproducible. Pin to specific version.
- **Copying everything before `npm install`** — busts cache on every code change. Copy lock files first.
- **Single-stage builds** — production image includes dev dependencies and build tools
- **Secrets in Dockerfile** — `ENV DB_PASSWORD=secret` is visible in image layers. Use runtime env vars.
- **Missing healthchecks** — compose `depends_on` without `service_healthy` doesn't wait for readiness

## Context7

- **Docker:** search for `docker` — Dockerfile reference, compose spec, best practices
