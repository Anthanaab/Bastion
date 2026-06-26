FROM node:22-alpine

WORKDIR /app
COPY index.js .

ENV WOL_RELAY_PORT=9877
ENV WOL_RELAY_BIND=127.0.0.1

CMD ["node", "index.js"]
