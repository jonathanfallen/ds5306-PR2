FROM node:20-alpine

WORKDIR /app

COPY services/chatroom-service/package*.json ./
RUN npm install --omit=dev

COPY services/chatroom-service ./services/chatroom-service
COPY contracts /contracts

WORKDIR /app/services/chatroom-service

EXPOSE 50053
CMD ["node", "src/server.js"]
