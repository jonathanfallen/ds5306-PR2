FROM node:20-alpine

WORKDIR /app

# Install deps (cache-friendly)
COPY services/login-service/package*.json ./
RUN npm install --omit=dev

# Copy login-service source
COPY services/login-service ./services/login-service

# Copy shared protos to the absolute path your code uses
COPY contracts /contracts

WORKDIR /app/services/login-service

EXPOSE 50051
CMD ["node", "src/server.js"]
