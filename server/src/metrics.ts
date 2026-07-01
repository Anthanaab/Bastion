import { Client } from "ssh2";
import type { Host } from "./db";
import { verifySshHostKey } from "./ssh-known-hosts";

export interface HostMetrics {
  hostId: string;
  at: string;
  os: string | null;
  uptimeSec: number | null;
  cpu: { load1: number; cores: number | null } | null;
  memory: { totalMb: number; usedMb: number; usedPct: number } | null;
  disk: { totalGb: number; usedGb: number; usedPct: number } | null;
}

export interface HostMetricsError {
  hostId: string;
  error: string;
}

export type HostMetricsResult = HostMetrics | HostMetricsError;

// Les sections sont délimitées par des marqueurs pour un parsing robuste.
// Linux via /proc, avec repli partiel BSD/macOS (sysctl/uname) — les champs
// non disponibles restent simplement null côté client.
const METRICS_COMMAND = [
  `echo "@@LOAD@@"; cat /proc/loadavg 2>/dev/null || sysctl -n vm.loadavg 2>/dev/null`,
  `echo "@@CPUS@@"; nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null`,
  `echo "@@MEM@@"; grep -E '^(MemTotal|MemAvailable):' /proc/meminfo 2>/dev/null`,
  `echo "@@DISK@@"; df -Pk / 2>/dev/null | tail -1`,
  `echo "@@UPTIME@@"; cut -d' ' -f1 /proc/uptime 2>/dev/null`,
  `echo "@@OS@@"; (. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME") || uname -sr 2>/dev/null`,
].join("; ");

const CONNECT_TIMEOUT_MS = 8_000;
const TOTAL_TIMEOUT_MS = 12_000;
const CACHE_TTL_MS = 30_000;

const cache = new Map<string, { at: number; result: HostMetricsResult }>();
const inflight = new Map<string, Promise<HostMetricsResult>>();

function section(output: string, marker: string): string {
  const match = output.match(
    new RegExp(`@@${marker}@@\\n([\\s\\S]*?)(?=@@[A-Z]+@@|$)`)
  );
  return match?.[1]?.trim() ?? "";
}

export function parseMetrics(hostId: string, output: string): HostMetrics {
  const loadRaw = section(output, "LOAD").replace(/[{}]/g, "").trim();
  const load1 = parseFloat(loadRaw.split(/\s+/)[0] ?? "");
  const cores = parseInt(section(output, "CPUS"), 10);

  let memory: HostMetrics["memory"] = null;
  const mem = section(output, "MEM");
  const totalKb = parseInt(mem.match(/MemTotal:\s+(\d+)/)?.[1] ?? "", 10);
  const availKb = parseInt(mem.match(/MemAvailable:\s+(\d+)/)?.[1] ?? "", 10);
  if (Number.isFinite(totalKb) && Number.isFinite(availKb) && totalKb > 0) {
    const usedKb = totalKb - availKb;
    memory = {
      totalMb: Math.round(totalKb / 1024),
      usedMb: Math.round(usedKb / 1024),
      usedPct: Math.round((usedKb / totalKb) * 100),
    };
  }

  let disk: HostMetrics["disk"] = null;
  const diskFields = section(output, "DISK").split(/\s+/);
  const diskTotalKb = parseInt(diskFields[1] ?? "", 10);
  const diskUsedKb = parseInt(diskFields[2] ?? "", 10);
  if (Number.isFinite(diskTotalKb) && Number.isFinite(diskUsedKb) && diskTotalKb > 0) {
    disk = {
      totalGb: Math.round((diskTotalKb / 1024 / 1024) * 10) / 10,
      usedGb: Math.round((diskUsedKb / 1024 / 1024) * 10) / 10,
      usedPct: Math.round((diskUsedKb / diskTotalKb) * 100),
    };
  }

  const uptime = parseFloat(section(output, "UPTIME"));
  const os = section(output, "OS").split("\n")[0]?.trim() || null;

  return {
    hostId,
    at: new Date().toISOString(),
    os,
    uptimeSec: Number.isFinite(uptime) ? Math.round(uptime) : null,
    cpu: Number.isFinite(load1)
      ? { load1, cores: Number.isFinite(cores) ? cores : null }
      : null,
    memory,
    disk,
  };
}

function collectOverSsh(host: Host): Promise<HostMetricsResult> {
  return new Promise((resolve) => {
    const conn = new Client();
    let settled = false;

    const finish = (result: HostMetricsResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        conn.end();
      } catch {
        /* ignore */
      }
      resolve(result);
    };

    const timer = setTimeout(
      () => finish({ hostId: host.id, error: "Délai dépassé" }),
      TOTAL_TIMEOUT_MS
    );

    conn.on("ready", () => {
      conn.exec(METRICS_COMMAND, (err, stream) => {
        if (err) {
          finish({ hostId: host.id, error: err.message });
          return;
        }
        let output = "";
        stream.on("data", (data: Buffer) => {
          output += data.toString();
        });
        stream.on("close", () => {
          finish(parseMetrics(host.id, output));
        });
      });
    });

    conn.on(
      "keyboard-interactive",
      (_name, _instructions, _lang, prompts, done) => {
        done(prompts.map(() => host.password ?? ""));
      }
    );

    conn.on("error", (err) => {
      finish({ hostId: host.id, error: err.message });
    });

    const config: Parameters<Client["connect"]>[0] = {
      host: host.hostname,
      port: host.port,
      username: host.username,
      readyTimeout: CONNECT_TIMEOUT_MS,
      tryKeyboard: true,
      hostVerifier: (key: Buffer, callback: (verified: boolean) => void) => {
        callback(verifySshHostKey(host.hostname, host.port, key));
      },
    };
    if (host.privateKey) {
      config.privateKey = host.privateKey;
      if (host.password) config.passphrase = host.password;
    } else if (host.password) {
      config.password = host.password;
    }

    try {
      conn.connect(config);
    } catch (err) {
      finish({
        hostId: host.id,
        error: err instanceof Error ? err.message : "Connexion impossible",
      });
    }
  });
}

export function getHostMetrics(host: Host): Promise<HostMetricsResult> {
  if (host.protocol !== "ssh") {
    return Promise.resolve({
      hostId: host.id,
      error: "Métriques disponibles uniquement pour les hôtes SSH",
    });
  }
  if (!host.privateKey && !host.password) {
    return Promise.resolve({
      hostId: host.id,
      error: "Aucun identifiant SSH enregistré pour cet hôte",
    });
  }

  const hit = cache.get(host.id);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return Promise.resolve(hit.result);
  }

  const pending = inflight.get(host.id);
  if (pending) return pending;

  const promise = collectOverSsh(host)
    .then((result) => {
      cache.set(host.id, { at: Date.now(), result });
      return result;
    })
    .finally(() => {
      inflight.delete(host.id);
    });

  inflight.set(host.id, promise);
  return promise;
}
