# Builds the customer web app and the admin console, served by nginx.
FROM node:22-bookworm-slim AS build
WORKDIR /app
ARG VITE_API_URL=/api
ARG VITE_WS_URL=
ARG VITE_BRAND_NAME=BetX
ENV VITE_API_URL=$VITE_API_URL VITE_WS_URL=$VITE_WS_URL VITE_BRAND_NAME=$VITE_BRAND_NAME
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
COPY admin/package.json admin/
RUN npm ci --workspace frontend --workspace admin --include-workspace-root=false
COPY frontend frontend
COPY admin admin
RUN npm run build --workspace frontend && npm run build --workspace admin

FROM nginx:1.27-alpine
COPY --from=build /app/frontend/dist /usr/share/nginx/html/web
COPY --from=build /app/admin/dist /usr/share/nginx/html/admin
COPY docker/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY docker/nginx/proxy_params.inc /etc/nginx/conf.d/proxy_params.inc
EXPOSE 80 8081
