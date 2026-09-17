# ============================================================
# BUILD
# ============================================================
FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src

# VITE_API_BASE_URL opcional: si no se define, el frontend usa
# automáticamente el mismo host donde se abre la página, puerto 3010.
ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

RUN npm run build


# ============================================================
# PRODUCTION
# ============================================================
FROM node:22-alpine AS production

WORKDIR /app

RUN npm install -g serve@14

COPY --from=builder /app/dist ./dist

EXPOSE 3000

CMD ["serve", "-s", "dist", "-l", "3000"]
