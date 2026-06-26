import crypto from "crypto";
import fs from "fs";
import path from "path";

type KnownHostsStore = Record<string, string>;

let storePath = "";
let knownHosts: KnownHostsStore = {};

function persist(): void {
  const dir = path.dirname(storePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(storePath, JSON.stringify(knownHosts, null, 2), "utf8");
}

export function initSshKnownHosts(databasePath: string): void {
  const dir = path.dirname(
    databasePath.endsWith(".json")
      ? databasePath
      : path.join(databasePath.replace(/\.db$/, "") + ".json")
  );
  storePath = path.join(dir, "ssh-known-hosts.json");
  if (fs.existsSync(storePath)) {
    knownHosts = JSON.parse(
      fs.readFileSync(storePath, "utf8")
    ) as KnownHostsStore;
  }
}

function hostKeyId(hostname: string, port: number): string {
  return `${hostname}:${port}`;
}

function fingerprint(key: Buffer): string {
  return crypto.createHash("sha256").update(key).digest("base64");
}

export function verifySshHostKey(
  hostname: string,
  port: number,
  key: Buffer
): boolean {
  if (process.env.BASTION_SSH_STRICT_HOST_KEY === "false") {
    return true;
  }

  const id = hostKeyId(hostname, port);
  const fp = fingerprint(key);
  const known = knownHosts[id];

  if (!known) {
    knownHosts[id] = fp;
    persist();
    console.log(`[SSH] Nouvelle clé hôte enregistrée : ${id}`);
    return true;
  }

  if (known !== fp) {
    console.error(
      `[SSH] Clé hôte modifiée pour ${id} — connexion refusée (possible MITM)`
    );
    return false;
  }

  return true;
}
