FROM denoland/deno:2.0.0

WORKDIR /app

# Copy the server file
COPY server.ts .

# Cache dependencies
RUN deno cache server.ts

# Expose port 8000
EXPOSE 8000

# Run with network permissions only
CMD ["run", "--allow-net", "server.ts"]
