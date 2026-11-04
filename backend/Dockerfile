FROM node:22-alpine

WORKDIR /app

# copy manifests
COPY package*.json ./
COPY prisma ./prisma/
COPY prisma7.config.ts ./

# Added 27.09 failure in the backend Docker image(Daniel's laptop)
RUN apk add --no-cache python3 make g++

# installs backend packages inside the container
RUN npm install

# generate client bindings
RUN DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder" npx prisma generate

COPY . .

COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["docker-entrypoint.sh"]

# Previous startup: runs the repository test harness manually if needed.
# TODO: 28.09 Come back to this after checking with Janne
# CMD ["node", "src/index.js"]

# Normal startup: serves the HTTP API.
CMD ["node", "src/server.js"]
