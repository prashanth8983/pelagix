# Web app. Build context: the app/ directory.
#
#   docker build -t scorebase-app app/
#   docker build -t scorebase-zero --target zero app/     (zero-cache from the same install)
#
# VITE_ZERO_CACHE_URL is read at build time and baked into the browser bundle: it must be
# the URL the browser (not the container) uses to reach zero-cache.
ARG VITE_ZERO_CACHE_URL=http://localhost:4848

FROM node:22-alpine AS deps
# Pin the pnpm major the lockfile was made with; newer majors reject the build-script allowlist.
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS build
ARG VITE_ZERO_CACHE_URL
ENV VITE_ZERO_CACHE_URL=$VITE_ZERO_CACHE_URL
# src/generated/project.ts is written by `scorebase codegen`; it must exist before the build.
COPY . .
RUN pnpm build

# zero-cache, pinned to the exact @rocicorp/zero version the app was built against.
FROM deps AS zero
VOLUME /data
EXPOSE 4848
CMD ["pnpm", "exec", "zero-cache"]

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json /app/server.mjs ./
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "server.mjs"]
