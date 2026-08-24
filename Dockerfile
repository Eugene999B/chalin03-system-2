FROM node:20.20.2-slim

WORKDIR /app

COPY backend/package.json backend/package-lock.json ./backend/
RUN cd backend && npm ci --omit=dev

COPY backend ./backend
COPY database ./database

WORKDIR /app/backend

ENV NODE_ENV=production
ENV PORT=5000

CMD ["npm", "start"]
