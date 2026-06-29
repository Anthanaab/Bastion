import fs from "fs";
import path from "path";

const BACKUP_INTERVAL_MS = 6 * 60 * 60 * 1000;
const MAX_BACKUPS = 14;

let lastBackupAt = 0;
let dbPath = "";

export function initBackup(databasePath: string): void {
  dbPath = databasePath;
  const dir = path.join(path.dirname(databasePath), "backups");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function maybeBackup(reason = "persist"): void {
  if (!dbPath || !fs.existsSync(dbPath)) return;

  const now = Date.now();
  if (now - lastBackupAt < BACKUP_INTERVAL_MS) return;
  lastBackupAt = now;

  const dir = path.join(path.dirname(dbPath), "backups");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = path.join(dir, `bastion-${stamp}.json`);
  try {
    fs.copyFileSync(dbPath, dest);
    console.log(`[Bastion] Sauvegarde créée (${reason}) : ${path.basename(dest)}`);
    rotateBackups(dir);
  } catch (err) {
    console.error("[Bastion] Échec sauvegarde :", err);
  }
}

function rotateBackups(dir: string): void {
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith("bastion-") && f.endsWith(".json"))
    .map((f) => ({ f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  for (const { f } of files.slice(MAX_BACKUPS)) {
    try {
      fs.unlinkSync(path.join(dir, f));
    } catch {
      /* ignore */
    }
  }
}
