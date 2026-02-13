import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

// Koyeb auto assigns PORT
const PORT = Number(Deno.env.get("PORT") || 8000);

const UUID = Deno.env.get("UUID") || "f9a1ba12-7187-4b25-a5d5-7bafd82ffb4d";
const DOMAIN = Deno.env.get("DOMAIN") || "your-app.koyeb.app";
const WS_PATH = Deno.env.get("WS_PATH") || "ws";
const SUB_PATH = Deno.env.get("SUB_PATH") || "sub";

// UUID utils
function parseUUID(uuid: string): Uint8Array {
  uuid = uuid.replace(/-/g, "");
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    out[i] = parseInt(uuid.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function uuidEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.every((v, i) => v === b[i]);
}

async function parseVLESSHeader(data: Uint8Array) {
  const version = data[0];
  const id = data.slice(1, 17);

  if (!uuidEqual(id, parseUUID(UUID))) {
    throw new Error("Invalid UUID");
  }

  const optLen = data[17];
  const cmd = data[18 + optLen];
  if (cmd !== 1) throw new Error("Only TCP supported");

  const portIndex = 19 + optLen;
  const port = (data[portIndex] << 8) + data[portIndex + 1];
  const addrType = data[portIndex + 2];

  let host = "";
  let addrIndex = portIndex + 3;

  if (addrType === 1) {
    host = `${data[addrIndex]}.${data[addrIndex+1]}.${data[addrIndex+2]}.${data[addrIndex+3]}`;
    addrIndex += 4;
  } else if (addrType === 2) {
    const len = data[addrIndex];
    addrIndex++;
    host = new TextDecoder().decode(data.slice(addrIndex, addrIndex + len));
    addrIndex += len;
  }

  const rest = data.slice(addrIndex);
  return { version, host, port, rest };
}

async function handleWS(req: Request): Promise<Response> {
  const { socket, response } = Deno.upgradeWebSocket(req);

  socket.onmessage = async (event) => {
    try {
      const data = new Uint8Array(event.data);
      const vless = await parseVLESSHeader(data);

      const conn = await Deno.connect({
        hostname: vless.host,
        port: vless.port,
      });

      socket.send(new Uint8Array([vless.version, 0]));

      if (vless.rest.length > 0) {
        await conn.write(vless.rest);
      }

      (async () => {
        const buffer = new Uint8Array(4096);
        while (true) {
          const n = await conn.read(buffer);
          if (!n) break;
          socket.send(buffer.slice(0, n));
        }
        socket.close();
        conn.close();
      })();

      socket.onmessage = async (ev) => {
        await conn.write(new Uint8Array(ev.data));
      };

      socket.onclose = () => conn.close();

    } catch (err) {
      console.error(err);
      socket.close();
    }
  };

  return response;
}

serve(async (req: Request) => {
  const url = new URL(req.url);

  if (url.pathname === "/") {
    return new Response("Koyeb VLESS WS Running");
  }

  if (url.pathname === `/${SUB_PATH}`) {
    const vless =
      `vless://${UUID}@${DOMAIN}:443` +
      `?encryption=none` +
      `&security=tls` +
      `&type=ws` +
      `&host=${DOMAIN}` +
      `&path=/${WS_PATH}` +
      `&sni=${DOMAIN}` +
      `#Koyeb-WS`;

    return new Response(btoa(vless), {
      headers: { "Content-Type": "text/plain" },
    });
  }

  if (url.pathname === `/${WS_PATH}`) {
    if (req.headers.get("upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 400 });
    }
    return handleWS(req);
  }

  return new Response("Not Found", { status: 404 });

}, { port: PORT });

console.log(`Server running on port ${PORT}`);
