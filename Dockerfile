# syntax=docker/dockerfile:1

ARG NODE_VERSION=22.23.1

FROM node:${NODE_VERSION}-bookworm-slim AS dependencies

WORKDIR /app

RUN apt-get update \
    && apt-get install --yes --no-install-recommends build-essential python3 \
    && rm -rf /var/lib/apt/lists/*

COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY deploy/docker/generate-node-license-inventory.js /tmp/generate-node-license-inventory.js
RUN node /tmp/generate-node-license-inventory.js /app/node_modules /tmp/npm-production-packages.tsv

FROM node:${NODE_VERSION}-bookworm-slim AS runtime

ENV NODE_ENV=production \
    MANEBID_CONFIG_FILE=/etc/manebid/config.json \
    MANEBID_ENV_FILE=/run/secrets/manebid_env \
    TZ=Europe/London

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates tini tzdata \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=dependencies /app/node_modules ./node_modules
COPY backend/ ./
COPY deploy/docker/backend-config.json /etc/manebid/config.json
COPY public/THIRD_PARTY_NOTICES.md public/licenses/Apache-2.0.txt /usr/share/licenses/manebid/
COPY --from=dependencies /tmp/npm-production-packages.tsv /usr/share/licenses/manebid/npm-production-packages.tsv

RUN mkdir -p /var/lib/manebid \
    && dpkg-query -W -f='${binary:Package}\t${Version}\n' \
      | LC_ALL=C sort > /tmp/debian-packages.tsv \
    && printf 'package\tversion\n' \
      > /usr/share/licenses/manebid/debian-packages.tsv \
    && cat /tmp/debian-packages.tsv \
      >> /usr/share/licenses/manebid/debian-packages.tsv \
    && rm /tmp/debian-packages.tsv \
    && printf 'Node.js\t%s\n' "$(node --version)" \
      > /usr/share/licenses/manebid/runtime-versions.tsv \
    && chown node:node /var/lib/manebid

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "backend.js"]
