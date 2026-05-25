FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json* tsconfig.json tsconfig.base.json vitest.config.ts ./
COPY apps/addon/package.json apps/addon/package.json
COPY apps/configure/package.json apps/configure/package.json
COPY packages/core/package.json packages/core/package.json

RUN npm ci

COPY apps apps
COPY packages packages
COPY scripts scripts

RUN npm run build

FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=7331

COPY --from=build /app/package.json /app/package-lock.json* ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/addon/package.json ./apps/addon/package.json
COPY --from=build /app/apps/addon/dist ./apps/addon/dist
COPY --from=build /app/packages/core/package.json ./packages/core/package.json
COPY --from=build /app/packages/core/dist ./packages/core/dist

EXPOSE 7331

CMD ["node", "apps/addon/dist/server.js"]
