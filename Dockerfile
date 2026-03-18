FROM node:22-slim

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_BROWSERS_PATH=0
ENV NODE_ENV=production

WORKDIR /app

COPY package.json ./

# Install all deps (including devDependencies for tsc)
RUN NODE_ENV=development npm install --ignore-scripts

# Copy source
COPY tsconfig.json ./
COPY src/ src/
COPY config/ config/
COPY public/ public/

# Build TypeScript using the locally installed tsc
RUN ./node_modules/.bin/tsc

# Prune devDependencies
RUN npm prune --production

# Create data directories
RUN mkdir -p data/tasks data/uploads logs

EXPOSE 7400

CMD ["node", "dist/index.js"]
