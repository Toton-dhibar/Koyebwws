import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

// 🔒 Hardcoded Target Server
const TARGET_HOST = "zz.sdbuild.me";
const TARGET_HTTPS = `https://${TARGET_HOST}`;
const TARGET_WSS = `wss://${TARGET_HOST}`;

// ⚠️ Koyeb Dynamic Port (VERY IMPORTANT)
const PORT = parseInt(Deno.env.get("PORT")!);

// ---------------- WebSocket Handler (/wsvm only) ----------------

async function handleWebSocket(req: Request): Promise<Response> {
  const { socket: clientWs, response } = Deno.upgradeWebSocket(req);
  const url = new URL(req.url);

  // Forward to target with same path/query
  const targetWsUrl = `${TARGET_WSS}${url.pathname}${url.search}`;
  const targetWs = new WebSocket(targetWsUrl);

  const queue: any[] = [];

  const cleanup = () => {
    try { clientWs.close(); } catch {}
    try { targetWs.close(); } catch {}
  };

  // ❤️ Heartbeat to reduce idle timeout
  const heartbeat = setInterval(() => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send("ping");
    }
  }, 20000);

  targetWs.onopen = () => {
    while (queue.length) {
      targetWs.send(queue.shift());
    }
  };

  clientWs.onmessage = (e) => {
    if (targetWs.readyState === WebSocket.OPEN) {
      targetWs.send(e.data);
    } else {
      queue.push(e.data);
    }
  };

  targetWs.onmessage = (e) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(e.data);
    }
  };

  targetWs.onerror = cleanup;
  clientWs.onerror = cleanup;

  targetWs.onclose = cleanup;
  clientWs.onclose = () => {
    clearInterval(heartbeat);
    cleanup();
  };

  return response;
}

// ---------------- HTTP Reverse Proxy ----------------

async function handleHTTP(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const targetUrl = `${TARGET_HTTPS}${url.pathname}${url.search}`;

    const headers = new Headers();
    const skipHeaders = [
      "host",
      "connection",
      "upgrade",
      "keep-alive",
      "proxy-connection"
    ];

    for (const [key, value] of req.headers.entries()) {
      if (!skipHeaders.includes(key.toLowerCase())) {
        headers.set(key, value);
      }
    }

    headers.set("Host", TARGET_HOST);

    const res = await fetch(targetUrl, {
      method: req.method,
      headers,
      body: ["GET", "HEAD"].includes(req.method)
        ? undefined
        : req.body,
      redirect: "manual",
    });

    const resHeaders = new Headers(res.headers);
    resHeaders.delete("transfer-encoding");
    resHeaders.delete("content-encoding");

    return new Response(res.body, {
      status: res.status,
      headers: resHeaders,
    });

  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: "Proxy Error", detail: err.message }),
      {
        status: 502,
        headers: { "content-type": "application/json" },
      }
    );
  }
}

// ---------------- Main Server ----------------

serve((req: Request) => {
  const url = new URL(req.url);

  // WebSocket only on /wsvm
  if (
    url.pathname === "/wsvm" &&
    req.headers.get("upgrade")?.toLowerCase().includes("websocket")
  ) {
    return handleWebSocket(req);
  }

  return handleHTTP(req);

}, { port: PORT });

console.log(`🚀 Server running on port ${PORT}`);
