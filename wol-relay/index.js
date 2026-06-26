const http = require("http");
const dgram = require("dgram");

const WOL_PORTS = [9, 7];
const WOL_REPEATS = 3;
const WOL_REPEAT_DELAY_MS = 150;
const PORT = parseInt(process.env.WOL_RELAY_PORT ?? "9877", 10);
const BIND = process.env.WOL_RELAY_BIND ?? "127.0.0.1";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeMac(mac) {
  const hex = String(mac).replace(/[^0-9a-fA-F]/g, "");
  if (hex.length !== 12) {
    throw new Error("Adresse MAC invalide");
  }
  return Buffer.from(hex, "hex");
}

function buildMagicPacket(mac) {
  const packet = Buffer.alloc(6 + 16 * 6);
  packet.fill(0xff, 0, 6);
  for (let i = 0; i < 16; i++) {
    mac.copy(packet, 6 + i * 6);
  }
  return packet;
}

function sendMagicPacketOnce(mac, address, port) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    const packet = buildMagicPacket(mac);

    socket.on("error", (err) => {
      try {
        socket.close();
      } catch {
        /* ignore */
      }
      reject(err);
    });

    socket.bind(() => {
      try {
        socket.setBroadcast(true);
      } catch {
        /* ignore */
      }

      socket.send(packet, port, address, (err) => {
        try {
          socket.close();
        } catch {
          /* ignore */
        }
        if (err) reject(err);
        else resolve();
      });
    });
  });
}

async function sendMagicPacketBurst(mac, address) {
  for (let repeat = 0; repeat < WOL_REPEATS; repeat++) {
    for (const wolPort of WOL_PORTS) {
      await sendMagicPacketOnce(mac, address, wolPort);
    }
    if (repeat < WOL_REPEATS - 1) {
      await sleep(WOL_REPEAT_DELAY_MS);
    }
  }
}

async function wake(macAddress, targets) {
  const mac = normalizeMac(macAddress);
  const sentTo = [];

  for (const address of targets) {
    if (!address || typeof address !== "string") continue;
    await sendMagicPacketBurst(mac, address.trim());
    sentTo.push(
      `${address.trim()} (×${WOL_REPEATS}, ports ${WOL_PORTS.join("/")})`
    );
    console.log(`[wol-relay] Paquet envoyé → ${address.trim()}`);
  }

  if (sentTo.length === 0) {
    throw new Error("Aucune cible WoL");
  }

  return sentTo;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 4096) {
        reject(new Error("Corps trop volumineux"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }

    if (req.method !== "POST" || req.url !== "/wake") {
      res.writeHead(404);
      res.end();
      return;
    }

    const raw = await readBody(req);
    const payload = JSON.parse(raw);
    const mac = payload.mac;
    const targets = Array.isArray(payload.targets) ? payload.targets : [];

    if (!mac) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "MAC requise" }));
      return;
    }

    const sentTo = await wake(mac, targets);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, sentTo }));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur WoL";
    console.error("[wol-relay]", message);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: message }));
  }
});

server.listen(PORT, BIND, () => {
  console.log(`[wol-relay] Écoute sur ${BIND}:${PORT}`);
});
