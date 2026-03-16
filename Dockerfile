FROM node:22-slim

# Skip Playwright browser download — browse endpoints gracefully fail on cloud
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV NODE_ENV=production

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate

# Copy package files first for layer caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Install dependencies
RUN pnpm install --frozen-lockfile --prod=false

# Copy source
COPY tsconfig.json ./
COPY src/ src/
COPY config/ config/
COPY public/ public/

# Build TypeScript
RUN pnpm build

# Create data directories
RUN mkdir -p data/tasks data/uploads logs

EXPOSE 7400

CMD ["node", "dist/index.js"]
