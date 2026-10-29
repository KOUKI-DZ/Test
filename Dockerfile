FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY server.js ./server.js
COPY index.html ./index.html
EXPOSE 3000
CMD ["node", "server.js"]
