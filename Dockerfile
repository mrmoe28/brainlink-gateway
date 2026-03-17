FROM node:22-slim

# Skip Playwright entirely in cloud mode
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_BROWSERS_PATH=0
ENV NODE_ENV=production

WORKDIR /app

# Use npm instead of pnpm (simpler, no corepack issues)
COPY package.json ./

# Generate package-lock and install
RUN npm install --ignore-scripts 2>/dev/null; \
    npx playwright install-deps 2>/dev/null || true

# Copy source
COPY tsconfig.json ./
COPY src/ src/
COPY config/ config/
COPY public/ public/

# Build TypeScript
RUN npx tsc

# Create data directories
RUN mkdir -p data/tasks data/uploads logs

EXPOSE 7400

CMD ["node", "dist/index.js"]
