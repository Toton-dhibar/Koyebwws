FROM denoland/deno:alpine-1.42.4

WORKDIR /app
COPY server.ts .

CMD ["deno", "run", "--allow-net", "--allow-env", "--unstable", "server.ts"]
