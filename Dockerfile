FROM node:22-alpine AS builder

RUN apk add --no-cache python3 make g++

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install

COPY . .
RUN npm run build

FROM node:22-alpine

RUN apk add --no-cache python3 make g++ wget su-exec

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/client/dist ./client/dist
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN addgroup -S bastion \
  && adduser -S bastion -G bastion \
  && mkdir -p /app/data \
  && chown -R bastion:bastion /app \
  && chmod +x /usr/local/bin/docker-entrypoint.sh

ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_PATH=/app/data/bastion.json
ENV GUACD_HOST=guacd
ENV GUACD_PORT=4822

EXPOSE 3000

# Démarre en root (nécessaire pour corriger les permissions d'un volume
# existant), puis bascule immédiatement sur l'utilisateur non-privilégié
# "bastion" avant d'exécuter le process Node.
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server/dist/index.js"]
