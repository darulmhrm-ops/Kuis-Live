# KuisLive — Docker image (untuk Northflank, Koyeb, Railway, Fly.io, dll)
FROM node:20-alpine

WORKDIR /app

# install dependency dulu (layer cache lebih cepat)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# salin kode aplikasi
COPY . .

# port default (platform biasanya meng-override via env PORT)
ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]
