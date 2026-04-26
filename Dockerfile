FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY types/ ./types/
COPY src/ ./src/
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/build ./build
ENV NODE_ENV=production
ENV TRANSPORT=http
ENV PORT=8080
EXPOSE 8080
CMD ["node", "build/server.js"]
