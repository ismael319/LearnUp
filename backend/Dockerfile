# Imagem de produção da API LearnUp.
# Build:  docker build -t learnup-api ./backend
FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# dumb-init garante o forward de SIGTERM para o Node (encerramento limpo).
RUN apk add --no-cache dumb-init

COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./
COPY src ./src

# Não roda como root.
USER node

EXPOSE 4000
# A porta vem do ambiente: plataformas como o Render injetam PORT (ex.: 10000)
# e roteiam para ela. Fixar 4000 aqui faria o healthcheck falhar nesses hosts.
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "const p=process.env.PORT||4000;fetch('http://127.0.0.1:'+p+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "src/server.js"]
