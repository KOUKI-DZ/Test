FROM node:22-bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends libimage-exiftool-perl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY server.js ./server.js
COPY index.html ./public/index.html
ENV NODE_ENV=production
CMD ["node", "server.js"]
