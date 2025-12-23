FROM node:20-alpine

WORKDIR /app

# Native deps for better-sqlite3
RUN apk add --no-cache python3 make g++

COPY server/package.json server/package-lock.json* ./
RUN npm install --omit=dev

COPY server/src ./src

# Frontend assets
COPY web ./public

ENV NODE_ENV=production
ENV PORT=8787

EXPOSE 8787

CMD ["node", "src/server.js"]
