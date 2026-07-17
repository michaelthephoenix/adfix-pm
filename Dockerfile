FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=4000 \
    APP_ORIGIN=http://localhost:4000 \
    COOKIE_SECURE=false \
    PGLITE_DATA_DIR=/app/data/pglite \
    LOCAL_UPLOAD_DIR=/app/data/uploads \
    WEB_DIST_DIR=/app/apps/web/dist \
    CORS_ALLOWED_ORIGINS=http://localhost:4000
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/db ./apps/api/db
COPY --from=build /app/apps/web/dist ./apps/web/dist
RUN mkdir -p /app/data && chown -R node:node /app
USER node
EXPOSE 4000
VOLUME ["/app/data"]
CMD ["npm", "run", "start"]
