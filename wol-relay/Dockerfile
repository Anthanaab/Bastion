FROM node:22-alpine

WORKDIR /app
COPY index.js .

ENV WOL_RELAY_PORT=9877
ENV WOL_RELAY_BIND=0.0.0.0

CMD ["node", "index.js"]
