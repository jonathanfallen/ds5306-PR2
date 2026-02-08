FROM node:24-alpine

WORKDIR /app

COPY services/tester-service/package*.json ./
RUN npm ci --omit=dev

COPY services/tester-service/src ./src
COPY contracts/proto /contracts/proto

CMD ["npm", "start"]
