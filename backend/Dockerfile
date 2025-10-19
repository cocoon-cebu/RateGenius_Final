FROM node:20-bullseye-slim

# install dependencies needed by Playwright browsers
RUN apt-get update && apt-get install -y wget ca-certificates gnupg libnss3 libatk1.0-0 libgtk-3-0 libxss1 libasound2 libgbm1 libx11-xcb1 libxcomposite1 libxrandr2 libasound2 libxdamage1 libxfixes3 libpangocairo-1.0-0 libpango-1.0-0 libpangocairo-1.0-0 libatspi2.0-0 --no-install-recommends && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
# install playwright browsers
RUN npx playwright install --with-deps

EXPOSE 5000
CMD ["node", "index.js"]
