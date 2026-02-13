import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const TARGET_HOST = "zz.sdbuild.me";
const TARGET_HTTPS = `https://${TARGET_HOST}`;
const TARGET_WSS = `wss://${TARGET_HOST}`;
const PORT = 8000;

// ---------------- WebSocket Proxy ----------------

async function handleWebSocket(req: Request) {
  const { socket: clientWs, response } = Deno.upgradeWebSocket(req);
  const url = new URL(req.url);

  const targetWs = new WebSocket(`${TARGET_WSS}${url.pathname}${url.search}`);
  const queue: (string | ArrayBufferLike | Blob | ArrayBufferView)[] = [];

  const cleanup = () => {
    try { clientWs.close(); } catch {}
    try { targetWs.close(); } catch {}
  };

  targetWs.onopen = () => {
    while (queue.length) targetWs.send(queue.shift()!);
  };

  clientWs.onmessage = (e) => {
    if (targetWs.readyState === WebSocket.OPEN)
      targetWs.send(e.data);
    else
      queue.push(e.data);
  };

  targetWs.onmessage = (e) => {
    if (clientWs.readyState === WebSocket.OPEN)
      clientWs.send(e.data);
  };

  targetWs.onclose = cleanup;
  clientWs.onclose = cleanup;
  targetWs.onerror = cleanup;
  clientWs.onerror = cleanup;

  return response;
}

// ---------------- HTTP Reverse Proxy ----------------

async function handleHTTP(req: Request) {
  try {
    const url = new URL(req.url);
    const targetUrl = `${TARGET_HTTPS}${url.pathname}${url.search}`;

    const headers = new Headers();
    const skip = ["host","connection","upgrade","keep-alive","proxy-connection"];

    for (const [k,v] of req.headers.entries()) {
      if (!skip.includes(k.toLowerCase())) headers.set(k,v);
    }

    headers.set("Host", TARGET_HOST);

    const res = await fetch(targetUrl, {
      method: req.method,
      headers,
      body: ["GET","HEAD"].includes(req.method) ? undefined : req.body,
      redirect: "manual"
    });

    const resHeaders = new Headers(res.headers);
    resHeaders.delete("content-encoding");
    resHeaders.delete("transfer-encoding");

    return new Response(res.body, {
      status: res.status,
      headers: resHeaders
    });

  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Proxy Error", detail: err.message }),
      { status: 502, headers: { "content-type": "application/json" } }
    );
  }
}

// ---------------- Server ----------------

serve((req: Request) => {
  if (req.headers.get("upgrade")?.toLowerCase() === "websocket")
    return handleWebSocket(req);

  return handleHTTP(req);
}, { port: PORT });

console.log("Proxy running on port", PORT);
