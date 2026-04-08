FROM node:20-alpine AS base

# --- Dependencies ---
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

# --- Build ---
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src ./src
RUN npx tsc

# --- Production ---
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV MCP_TRANSPORT=http
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 mcp

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

USER mcp
EXPOSE 3333

CMD ["node", "dist/server.js"]
