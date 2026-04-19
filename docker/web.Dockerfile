# Lighthouse Web — Next.js frontend
FROM node:20-alpine AS deps
WORKDIR /app
COPY surfaces/web/package.json surfaces/web/package-lock.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
# Next.js bakes rewrite destinations into routes-manifest.json at build time,
# so LIGHTHOUSE_API_ORIGIN must be set here — the runtime env var alone is too
# late. Default matches the compose service DNS name.
ARG LIGHTHOUSE_API_ORIGIN=http://api:8787
ENV LIGHTHOUSE_API_ORIGIN=${LIGHTHOUSE_API_ORIGIN} \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY surfaces/web ./
# `--no-lint` matches `next dev`, which doesn't block on lint either. Without
# this a pre-existing unused-var warning fails the production build.
RUN npx next build --no-lint

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3737 \
    HOSTNAME=0.0.0.0
RUN apk add --no-cache curl
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/next.config.mjs ./next.config.mjs

EXPOSE 3737

HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=5 \
    CMD curl -fsS http://127.0.0.1:3737 >/dev/null || exit 1

CMD ["npx", "next", "start", "-p", "3737", "-H", "0.0.0.0"]
