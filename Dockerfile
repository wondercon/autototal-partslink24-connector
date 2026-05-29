FROM mcr.microsoft.com/playwright:v1.47.0-jammy

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY . .

RUN mkdir -p /data/screenshots && chown -R pwuser:pwuser /app /data

USER pwuser

EXPOSE 8080

CMD ["node", "src/index.js"]
