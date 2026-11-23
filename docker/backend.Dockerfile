# ── Build ────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
COPY admin/package.json admin/
RUN npm ci --workspace backend --include-workspace-root=false
COPY backend backend
RUN npm run build --workspace backend

# ── Runtime ──────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    DATABASE_DIR=/app/database
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
COPY admin/package.json admin/
RUN npm ci --workspace backend --include-workspace-root=false --omit=dev && npm cache clean --force
COPY --from=build /app/backend/dist backend/dist
COPY database database
USER node
WORKDIR /app/backend
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
