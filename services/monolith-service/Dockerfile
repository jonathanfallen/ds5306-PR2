FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm i --omit=dev

COPY . .
RUN apk add --no-cache netcat-openbsd
CMD ["npm", "start"]
