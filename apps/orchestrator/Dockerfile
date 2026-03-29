FROM node:24-slim
WORKDIR /app
RUN npm install -g pnpm
COPY package.json ./
COPY tsconfig.json ./
RUN pnpm install
COPY src ./src
RUN pnpm build
EXPOSE 4000
CMD ["node", "dist/index.js"]
