# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=22
ARG GO_VERSION=1.26

FROM --platform=$BUILDPLATFORM node:${NODE_VERSION}-alpine AS app-web-builder

WORKDIR /src

RUN corepack enable && corepack prepare pnpm@10.19.0 --activate

COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,target=/pnpm/store pnpm install --frozen-lockfile

COPY index.html vite.config.ts tsconfig.json tsconfig.app.json tsconfig.node.json ./
COPY public ./public
COPY src ./src

RUN pnpm build

FROM --platform=$BUILDPLATFORM node:${NODE_VERSION}-alpine AS ge2o-web-builder

WORKDIR /src

COPY vendor/go-emby2openlist/web/src/package.json \
  vendor/go-emby2openlist/web/src/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

COPY vendor/go-emby2openlist/web/src ./
RUN npm run build

FROM --platform=$BUILDPLATFORM golang:${GO_VERSION}-alpine AS ge2o-builder

ARG TARGETOS
ARG TARGETARCH

WORKDIR /src

COPY vendor/go-emby2openlist/go.mod vendor/go-emby2openlist/go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download

COPY vendor/go-emby2openlist/cmd ./cmd
COPY vendor/go-emby2openlist/internal ./internal
COPY vendor/go-emby2openlist/main.go ./main.go
COPY vendor/go-emby2openlist/web/embed.go ./web/embed.go
COPY --from=ge2o-web-builder /src/build/client ./web/dist

RUN --mount=type=cache,target=/root/.cache/go-build \
  CGO_ENABLED=0 GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH:-amd64} \
  go build -tags=goexperiment.jsonv2 -trimpath \
  -ldflags="-s -w -X main.ginMode=release" -o /out/ge2o .

FROM node:${NODE_VERSION}-alpine AS runtime

ARG VERSION=dev
ARG VCS_REF=unknown
ARG BUILD_DATE=unknown

LABEL org.opencontainers.image.title="OpenStrmBridge" \
  org.opencontainers.image.description="STRM generation, storage management and Emby 302 proxy console" \
  org.opencontainers.image.source="https://github.com/ODJ0930/OpenStrmBridge" \
  org.opencontainers.image.version="${VERSION}" \
  org.opencontainers.image.revision="${VCS_REF}" \
  org.opencontainers.image.created="${BUILD_DATE}" \
  org.opencontainers.image.licenses="GPL-3.0-only"

RUN apk add --no-cache docker-cli tzdata

WORKDIR /app

ENV NODE_ENV=production \
  TZ=Asia/Shanghai \
  OPENSTRMBRIDGE_BACKEND_HOST=0.0.0.0 \
  OPENSTRMBRIDGE_BACKEND_PORT=5174 \
  OPENSTRMBRIDGE_DATA_DIR=/app/data \
  OPENSTRMBRIDGE_WEB_DIR=/app/dist \
  OPENSTRMBRIDGE_GE2O_BINARY=/app/resources/bin/ge2o \
  OPENSTRMBRIDGE_BACKEND_PUBLIC_URL=http://127.0.0.1:5174 \
  OPENSTRMBRIDGE_STRM_DIR=/app/strm \
  OPENSTRMBRIDGE_EMBY_MOUNT_PATH=/media/strm

COPY --from=app-web-builder /src/dist ./dist
COPY --from=ge2o-builder /out/ge2o ./resources/bin/ge2o
COPY server ./server
COPY resources/emby-plugins ./resources/emby-plugins
COPY package.json LICENSE README.md ./

RUN mkdir -p /app/data /app/strm && chmod +x /app/resources/bin/ge2o

VOLUME ["/app/data", "/app/strm"]

EXPOSE 5174 8097 8094

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:5174/api/health').then((response)=>{if(!response.ok)process.exit(1)}).catch(()=>process.exit(1))"]

STOPSIGNAL SIGTERM

CMD ["node", "server/storage-check-server.mjs"]
