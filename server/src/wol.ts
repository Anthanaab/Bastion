import dgram from "dgram";
import dns from "dns/promises";

const WOL_PORTS = [9, 7];
const WOL_REPEATS = 3;
const WOL_REPEAT_DELAY_MS = 150;

export function normalizeMac(mac: string): Buffer {
  const hex = mac.replace(/[^0-9a-fA-F]/g, "");
  if (hex.length !== 12) {
    throw new Error("Adresse MAC invalide (format attendu : AA:BB:CC:DD:EE:FF)");
  }
  return Buffer.from(hex, "hex");
}

export function isValidMac(mac: string): boolean {
  return /^([0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}$/.test(mac.trim());
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildMagicPacket(mac: Buffer): Buffer {
  const packet = Buffer.alloc(6 + 16 * 6);
  packet.fill(0xff, 0, 6);
  for (let i = 0; i < 16; i++) {
    mac.copy(packet, 6 + i * 6);
  }
  return packet;
}

function subnetBroadcast(ip: string): string | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  if (parts.some((p) => Number.isNaN(parseInt(p, 10)))) return null;
  return `${parts[0]}.${parts[1]}.${parts[2]}.255`;
}

async function resolveTargetIp(hostname: string): Promise<string | null> {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return hostname;
  try {
    const { address } = await dns.lookup(hostname, { family: 4 });
    return address;
  } catch {
    return null;
  }
}

function sendMagicPacketOnce(
  mac: Buffer,
  address: string,
  port: number
): Promise<void> {
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

async function sendMagicPacketBurst(
  mac: Buffer,
  address: string
): Promise<void> {
  for (let repeat = 0; repeat < WOL_REPEATS; repeat++) {
    for (const port of WOL_PORTS) {
      await sendMagicPacketOnce(mac, address, port);
    }
    if (repeat < WOL_REPEATS - 1) {
      await sleep(WOL_REPEAT_DELAY_MS);
    }
  }
}

export interface WakeHostOptions {
  hostname?: string;
  wolBroadcast?: string | null;
}

export async function wakeHost(
  macAddress: string,
  options: WakeHostOptions = {}
): Promise<{ sentTo: string[]; hint?: string }> {
  const mac = normalizeMac(macAddress);
  const targets = new Set<string>();

  const envBc = process.env.BASTION_WOL_BROADCAST?.trim();
  if (envBc) targets.add(envBc);
  if (options.wolBroadcast?.trim()) targets.add(options.wolBroadcast.trim());

  targets.add("255.255.255.255");

  if (options.hostname) {
    const ip = await resolveTargetIp(options.hostname);
    if (ip) {
      targets.add(ip);
      const subnet = subnetBroadcast(ip);
      if (subnet) targets.add(subnet);
    }
  }

  const sentTo: string[] = [];
  for (const address of targets) {
    try {
      await sendMagicPacketBurst(mac, address);
      sentTo.push(`${address} (×${WOL_REPEATS}, ports ${WOL_PORTS.join("/")})`);
      console.log(`[WOL] Paquet envoyé → ${address}`);
    } catch (err) {
      console.warn(`[WOL] Échec vers ${address}:`, err);
    }
  }

  if (sentTo.length === 0) {
    throw new Error("Impossible d'envoyer le paquet Wake-on-LAN");
  }

  const dockerBridge =
    process.env.BASTION_WOL_DOCKER_BRIDGE !== "false" &&
    !process.env.BASTION_NETWORK_HOST;

  return {
    sentTo,
    hint: dockerBridge
      ? "Docker en mode bridge : si le PC ne démarre pas, utilisez docker-compose.wol.yml (réseau host) — voir README."
      : undefined,
  };
}
