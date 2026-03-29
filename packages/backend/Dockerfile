# ── Build stage ──
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
RUN npx tsc

# ── Prod stage ──
FROM node:22-alpine AS prod
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
COPY circuits ./circuits
USER app
ENV CIRCUIT_DIR=/app/circuits
CMD ["node", "dist/index.js"]
