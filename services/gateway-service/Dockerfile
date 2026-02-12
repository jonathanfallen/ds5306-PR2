FROM node:24-alpine

WORKDIR /app

COPY services/gateway-service/package*.json ./
RUN npm ci --omit=dev

COPY services/gateway-service/src ./src
COPY contracts /contracts


EXPOSE 50052
CMD ["npm", "start"]
