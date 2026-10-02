FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY tsconfig.json vitest.config.ts ./
COPY src ./src
EXPOSE 4000
CMD ["npx", "tsx", "src/index.ts"]
