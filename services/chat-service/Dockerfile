FROM node:20-alpine
WORKDIR /app

COPY package.json ./
# package-lock có thể không tồn tại => copy kiểu này không fail
COPY package-lock.json ./
RUN npm ci || npm install

COPY . .
CMD ["node", "src/server.js"]
