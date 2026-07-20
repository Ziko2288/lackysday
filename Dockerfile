FROM node:20-alpine

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# Data must persist across restarts — mount a volume here in production.
VOLUME ["/app/data"]

EXPOSE 3000
CMD ["node", "server.js"]
