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
): Promise<string> {
  for (let repeat = 0; repeat < WOL_REPEATS; repeat++) {
    for (const port of WOL_PORTS) {
      await sendMagicPacketOnce(mac, address, port);
    }
    if (repeat < WOL_REPEATS - 1) {
      await sleep(WOL_REPEAT_DELAY_MS);
    }
  }
  return `${address} (×${WOL_REPEATS}, ports ${WOL_PORTS.join("/")})`;
}

export interface WakeHostOptions {
  hostname?: string;
  wolBroadcast?: string | null;
}

async function collectTargets(
  options: WakeHostOptions
): Promise<string[]> {
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

  return [...targets];
}

const RELAY_TIMEOUT_MS = 5_000;

function relayUrls(): string[] {
  const urls = new Set<string>();
  const env = process.env.WOL_RELAY_URL?.trim();
  if (env) urls.add(env.replace(/\/$/, ""));
  urls.add("http://host.docker.internal:9877");
  urls.add("http://172.17.0.1:9877");
  return [...urls];
}

async function wakeViaRelay(
  macAddress: string,
  targets: string[]
): Promise<{ sentTo: string[] }> {
  let lastError: Error | null = null;

  for (const base of relayUrls()) {
    try {
      const response = await fetch(`${base}/wake`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mac: macAddress, targets }),
        signal: AbortSignal.timeout(RELAY_TIMEOUT_MS),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        sentTo?: string[];
      };

      if (!response.ok) {
        throw new Error(
          payload.error ?? `Relais WoL indisponible (${response.status})`
        );
      }

      if (!payload.sentTo?.length) {
        throw new Error("Relais WoL : réponse invalide");
      }

      console.log(`[WOL] Relais OK via ${base}`);
      return { sentTo: payload.sentTo };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(`[WOL] Relais ${base} : ${lastError.message}`);
    }
  }

  const detail = lastError?.message ?? "connexion refusée";
  throw new Error(
    `Relais WoL injoignable (${detail}). Vérifiez que bastion-wol-relay tourne : docker ps | grep wol-relay`
  );
}

async function wakeDirect(
  macAddress: string,
  targets: string[]
): Promise<{ sentTo: string[]; hint?: string }> {
  const mac = normalizeMac(macAddress);
  const sentTo: string[] = [];

  for (const address of targets) {
    try {
      const label = await sendMagicPacketBurst(mac, address);
      sentTo.push(label);
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
      ? "WoL depuis Docker bridge : activez le service wol-relay (défaut du docker-compose) ou définissez WOL_RELAY_URL."
      : undefined,
  };
}

export async function wakeHost(
  macAddress: string,
  options: WakeHostOptions = {}
): Promise<{ sentTo: string[]; hint?: string }> {
  const targets = await collectTargets(options);

  if (process.env.WOL_RELAY_URL?.trim()) {
    const result = await wakeViaRelay(macAddress, targets);
    console.log(`[WOL] Via relais → ${result.sentTo.join("; ")}`);
    return result;
  }

  return wakeDirect(macAddress, targets);
}
