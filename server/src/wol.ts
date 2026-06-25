import dgram from "dgram";
import dns from "dns/promises";

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

function sendMagicPacket(mac: Buffer, broadcast: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket("udp4");

    socket.on("error", (err) => {
      socket.close();
      reject(err);
    });

    const packet = Buffer.alloc(6 + 16 * 6);
    packet.fill(0xff, 0, 6);
    for (let i = 0; i < 16; i++) {
      mac.copy(packet, 6 + i * 6);
    }

    socket.bind(() => {
      socket.setBroadcast(true);
      socket.send(packet, 9, broadcast, (err) => {
        socket.close();
        if (err) reject(err);
        else resolve();
      });
    });
  });
}

export async function wakeHost(
  macAddress: string,
  hostname?: string
): Promise<{ sentTo: string[] }> {
  const mac = normalizeMac(macAddress);
  const broadcasts = new Set<string>();

  const envBc = process.env.BASTION_WOL_BROADCAST?.trim();
  if (envBc) broadcasts.add(envBc);
  broadcasts.add("255.255.255.255");

  if (hostname) {
    const ip = await resolveTargetIp(hostname);
    if (ip) {
      const subnet = subnetBroadcast(ip);
      if (subnet) broadcasts.add(subnet);
    }
  }

  const sentTo: string[] = [];
  for (const bc of broadcasts) {
    try {
      await sendMagicPacket(mac, bc);
      sentTo.push(bc);
    } catch (err) {
      console.warn(`[WOL] Échec envoi vers ${bc}:`, err);
    }
  }

  if (sentTo.length === 0) {
    throw new Error("Impossible d'envoyer le paquet Wake-on-LAN");
  }

  return { sentTo };
}
