FROM docker.io/library/node:22-alpine3.23 AS deps
WORKDIR /app

COPY app/package*.json .
COPY app/server/package.json ./server/
COPY app/web/package.json ./web/

# does not install devDependencies
RUN npm ci --omit=dev

FROM docker.io/library/node:22-alpine3.23 AS build
WORKDIR /app

COPY app/package*.json .
COPY app/server/package.json ./server/
COPY app/web/package.json ./web/

RUN npm ci
COPY app/ .
RUN npm run build

FROM docker.io/library/node:22-alpine3.23 AS prod

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/server/dist ./server/dist/
COPY --from=build /app/web/dist ./web/dist/

COPY --from=build /app/package.json ./
COPY --from=build /app/server/package.json ./server/
COPY --from=build /app/web/package.json ./web/

ARG GIT_SHA 
ARG APP_VERSION
ENV GIT_SHA=$GIT_SHA APP_VERSION=$APP_VERSION
USER node

EXPOSE 8000
CMD ["node", "server/dist/main.js"]