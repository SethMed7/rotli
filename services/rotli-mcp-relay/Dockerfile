FROM oven/bun:1.4.0-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY --chown=bun:bun package.json server.ts ./

USER bun
EXPOSE 3000

CMD ["bun", "run", "server.ts"]
