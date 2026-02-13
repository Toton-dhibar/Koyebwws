FROM denoland/deno:alpine-1.44.0

WORKDIR /app
COPY . .

RUN deno cache server.ts

EXPOSE 8000

CMD ["deno", "run", "--allow-net", "--allow-env", "--unstable", "server.ts"]
