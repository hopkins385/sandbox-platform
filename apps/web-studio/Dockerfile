FROM node:24-slim
WORKDIR /app
RUN npm install -g pnpm
COPY package.json ./
RUN pnpm install
COPY . .
RUN pnpm build
EXPOSE 3001
CMD ["node", ".output/server/index.mjs"]
