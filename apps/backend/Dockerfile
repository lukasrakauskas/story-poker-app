FROM node:22-bookworm-slim AS base
COPY --from=oven/bun:1.4.2 /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app

FROM base AS builder
COPY . .
RUN bun install --frozen-lockfile
RUN bunx --no-install turbo prune backend --docker

FROM base AS installer
COPY --from=builder /app/out/json/ .
COPY --from=builder /app/out/bun.lock ./bun.lock
COPY bunfig.toml .
RUN bun install --frozen-lockfile
COPY --from=builder /app/out/full/ .
RUN bun run build --filter=backend...

FROM base AS runner
COPY --from=installer /app .
WORKDIR /app/apps/backend
CMD ["bun", "run", "start:prod"]
