FROM node:24-alpine

WORKDIR /app

COPY services/login-service/package*.json ./
RUN npm ci --omit=dev

COPY services/login-service/src ./src
COPY contracts/proto /contracts/proto

EXPOSE 50051
CMD ["npm", "start"]
