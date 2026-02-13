// server.ts

const TARGET_HOST = 'zz.sdbuild.me';

console.log(`🚀 Proxy Server running on port 8000`);
console.log(`🎯 Target Host: ${TARGET_HOST}`);

Deno.serve({ port: 8000 }, async (req) => {
  const url = new URL(req.url);

  // 1. WebSocket Handler
  if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
    try {
      const { socket: clientWs, response } = Deno.upgradeWebSocket(req);
      const targetWsUrl = `wss://${TARGET_HOST}${url.pathname}${url.search}`;
      
      console.log(`🔌 Proxying WebSocket: ${url.pathname} -> ${targetWsUrl}`);

      const targetWs = new WebSocket(targetWsUrl);
      const queue: string[] = [];

      targetWs.onopen = () => {
        while (queue.length > 0) {
          const msg = queue.shift();
          if (msg) targetWs.send(msg);
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

      const cleanup = () => {
        try { if (clientWs.readyState === WebSocket.OPEN) clientWs.close(); } catch (_) {}
        try { if (targetWs.readyState === WebSocket.OPEN) targetWs.close(); } catch (_) {}
      };

      targetWs.onclose = cleanup;
      clientWs.onclose = cleanup;
      targetWs.onerror = cleanup;
      clientWs.onerror = cleanup;

      return response;
    } catch (wsErr) {
      console.error("WebSocket Error:", wsErr);
      return new Response("WebSocket Error", { status: 500 });
    }
  }

  // 2. HTTP Proxy Handler
  try {
    const targetUrl = `https://${TARGET_HOST}${url.pathname}${url.search}`;
    
    // Create a clean set of headers
    const headers = new Headers();
    // Headers to strip to avoid conflicts
    const skipHeaders = ['host', 'connection', 'upgrade', 'keep-alive', 'proxy-connection', 'content-length'];
    
    for (const [key, value] of req.headers.entries()) {
      if (!skipHeaders.includes(key.toLowerCase())) {
        headers.set(key, value);
      }
    }

    // Explicitly set the Host header for the target
    headers.set('Host', TARGET_HOST);

    const res = await fetch(targetUrl, {
      method: req.method,
      headers,
      body: !['GET', 'HEAD'].includes(req.method) ? req.body : null,
      redirect: 'manual',
    });

    // Strip hop-by-hop headers from response
    const resHeaders = new Headers(res.headers);
    resHeaders.delete('content-encoding');
    resHeaders.delete('transfer-encoding');

    // CORS (Optional: allows access from anywhere)
    resHeaders.set('Access-Control-Allow-Origin', '*');
    resHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    resHeaders.set('Access-Control-Allow-Headers', '*');

    return new Response(res.body, {
      status: res.status,
      headers: resHeaders,
    });

  } catch (err: any) {
    console.error("Fetch Error:", err.message);
    return new Response(JSON.stringify({ error: 'Proxy Error', details: err.message }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' }
    });
  }
});
