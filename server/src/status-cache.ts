import { probeTcp } from "./probe";

// Le tableau de bord de chaque client interroge /hosts/status toutes les 10 s :
// sans cache, chaque onglet/utilisateur déclenche un probe TCP complet de tous
// les hôtes. On mutualise les résultats quelques secondes et on déduplique les
// probes en cours pour que N clients ne coûtent qu'un seul probe par hôte.
const TTL_MS = 5_000;

interface CacheEntry {
  at: number;
  online: boolean;
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<boolean>>();

export function probeCached(hostname: string, port: number): Promise<boolean> {
  const key = `${hostname}:${port}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return Promise.resolve(hit.online);

  const pending = inflight.get(key);
  if (pending) return pending;

  const probe = probeTcp(hostname, port)
    .then((online) => {
      cache.set(key, { at: Date.now(), online });
      return online;
    })
    .catch(() => false)
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, probe);
  return probe;
}

export async function probeHostsCached(
  hosts: { id: string; hostname: string; port: number }[]
): Promise<Record<string, boolean>> {
  const entries = await Promise.all(
    hosts.map(
      async (host) => [host.id, await probeCached(host.hostname, host.port)] as const
    )
  );
  return Object.fromEntries(entries);
}
