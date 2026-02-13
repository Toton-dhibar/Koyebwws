// Koyeb-compatible Deno WebSocket & HTTP Proxy
const TARGET_HOST = 'zz.sdbuild.me';

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // 1. WebSocket Handler
  if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
    try {
      const { socket: clientWs, response } = Deno.upgradeWebSocket(req);
      const targetWsUrl = `wss://${TARGET_HOST}${url.pathname}${url.search}`;
      
      const targetWs = new WebSocket(targetWsUrl);
      const queue = [];

      targetWs.onopen = () => {
        while (queue.length > 0) targetWs.send(queue.shift());
      };

      clientWs.onmessage = (e) => {
        if (targetWs.readyState === WebSocket.OPEN) targetWs.send(e.data);
        else queue.push(e.data);
      };

      targetWs.onmessage = (e) => {
        if (clientWs.readyState === WebSocket.OPEN) clientWs.send(e.data);
      };

      const cleanup = () => {
        try { clientWs.close(); } catch (_) {}
        try { targetWs.close(); } catch (_) {}
      };

      targetWs.onclose = cleanup;
      clientWs.onclose = cleanup;

      return response;
    } catch (wsErr) {
      return new Response("WebSocket Error", { status: 500 });
    }
  }

  // 2. HTTP Proxy Handler
  try {
    const targetUrl = `https://${TARGET_HOST}${url.pathname}${url.search}`;
    
    // Create a clean set of headers
    const headers = new Headers();
    const skipHeaders = ['host', 'connection', 'upgrade', 'keep-alive', 'proxy-connection'];
    
    for (const [key, value] of req.headers.entries()) {
      if (!skipHeaders.includes(key.toLowerCase())) {
        headers.set(key, value);
      }
    }

    headers.set('Host', TARGET_HOST);

    const res = await fetch(targetUrl, {
      method: req.method,
      headers,
      body: !['GET', 'HEAD'].includes(req.method) ? req.body : null,
      redirect: 'manual',
    });

    // Strip hop-by-hop headers
    const resHeaders = new Headers(res.headers);
    resHeaders.delete('content-encoding');
    resHeaders.delete('transfer-encoding');

    return new Response(res.body, {
      status: res.status,
      headers: resHeaders,
    });

  } catch (err) {
    console.error("Fetch Error:", err.message);
    return new Response(JSON.stringify({ error: 'Proxy Error', details: err.message }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' }
    });
  }
});
