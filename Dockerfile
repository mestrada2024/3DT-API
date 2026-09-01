# ============================================================
# BUILD
# ============================================================
FROM node:22-alpine AS builder

WORKDIR /app

# Dependencias completas
COPY package.json package-lock.json ./
RUN npm ci

# Configuración
COPY tsconfig.json ./
COPY prisma.config.ts ./

# Prisma
COPY prisma ./prisma

# Código
COPY src ./src

# Generar Prisma Client
RUN npx prisma generate

# Compilar TypeScript
RUN npm run build


# ============================================================
# PRODUCTION
# ============================================================
FROM node:22-alpine AS production

WORKDIR /app

ENV NODE_ENV=production

# Instalar dependencias
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Aplicación compilada
COPY --from=builder /app/dist ./dist

# ============================================================
# IMPORTANTE:
# Prisma Client generado
# ============================================================
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

# Prisma schema/config
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts

# Logs
RUN mkdir -p /app/logs

EXPOSE 3010

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
