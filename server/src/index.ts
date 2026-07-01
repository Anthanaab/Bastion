import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import path from "path";
import http from "http";
import { parse as parseUrl } from "url";
import fs from "fs";
import { WebSocketServer } from "ws";
import {
  initDatabase,
  ensureAdminUser,
} from "./db";
import { initBackup } from "./backup";
import { initSshKnownHosts } from "./ssh-known-hosts";
import apiRouter from "./routes/api";
import { handleSshConnection } from "./ws/ssh";
import { handleGuacdConnection } from "./ws/guacd";
import { getJwtSecret } from "./auth";
import { assertEncryptionKeyConfigured } from "./crypto";
import { probeTcp } from "./probe";

const PORT = parseInt(process.env.PORT ?? "3000", 10);

const envPath = path.join(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

const DATABASE_PATH =
  process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "bastion.json");
const GUACD_HOST = process.env.GUACD_HOST ?? "127.0.0.1";
const GUACD_PORT = parseInt(process.env.GUACD_PORT ?? "4822", 10);
const ADMIN_USER = process.env.BASTION_ADMIN_USER ?? "admin";
const ADMIN_PASSWORD = process.env.BASTION_ADMIN_PASSWORD ?? "admin";

try {
  getJwtSecret();
  assertEncryptionKeyConfigured();
} catch (err) {
  console.error(`[Bastion] ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}

if (!process.env.BASTION_ADMIN_PASSWORD || process.env.BASTION_ADMIN_PASSWORD === "admin") {
  console.warn(
    "[Bastion] ATTENTION : le compte admin utilise le mot de passe par défaut (\"admin\"). " +
      "Changez BASTION_ADMIN_PASSWORD ou le mot de passe via l'UI avant d'exposer Bastion."
  );
}

if (
  process.env.WOL_RELAY_URL &&
  !process.env.WOL_RELAY_SECRET?.trim() &&
  !process.env.JWT_SECRET?.trim()
) {
  console.warn(
    "[Bastion] ATTENTION : WOL_RELAY_SECRET n'est pas défini — le relais WoL n'est protégé par aucun secret."
  );
}

initDatabase(DATABASE_PATH);
initBackup(DATABASE_PATH);
initSshKnownHosts(DATABASE_PATH);
ensureAdminUser(ADMIN_USER, ADMIN_PASSWORD);

const corsOrigins = process.env.BASTION_CORS_ORIGIN?.trim();
const app = express();

const trustProxyRaw = process.env.BASTION_TRUST_PROXY?.trim();
if (trustProxyRaw) {
  const asNumber = Number(trustProxyRaw);
  app.set(
    "trust proxy",
    Number.isFinite(asNumber) ? asNumber : trustProxyRaw
  );
} else {
  // Pas de proxy de confiance par défaut : évite qu'un client falsifie
  // X-Forwarded-For pour contourner le rate-limit de /login.
  // Définir BASTION_TRUST_PROXY=1 si Bastion est bien derrière un reverse-proxy (Traefik, etc.).
  app.set("trust proxy", false);
}

app.use(
  cors({
    // Sans BASTION_CORS_ORIGIN, on ne reflète plus n'importe quelle origine :
    // l'usage same-origin standard n'a de toute façon pas besoin de CORS.
    origin: corsOrigins ? corsOrigins.split(",").map((o) => o.trim()) : false,
    credentials: true,
  })
);
const CSP = [
  "default-src 'self'",
  "connect-src 'self' ws: wss:",
  "img-src 'self' data:",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "script-src 'self'",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "object-src 'none'",
].join("; ");

app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Content-Security-Policy", CSP);
  next();
});
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

app.use((req, _res, next) => {
  if (req.path.startsWith("/api") || req.path.startsWith("/ws")) {
    console.log(`[HTTP] ${req.method} ${req.originalUrl.split("?")[0]}`);
  }
  next();
});

app.use("/api", apiRouter);

app.get("/api/health", async (_req, res) => {
  const [guacdOk, databaseOk] = await Promise.all([
    probeTcp(GUACD_HOST, GUACD_PORT, 2000),
    Promise.resolve(fs.existsSync(DATABASE_PATH)),
  ]);
  const healthy = guacdOk && databaseOk;
  res.status(healthy ? 200 : 503).json({
    status: healthy ? "ok" : "degraded",
    name: "Bastion",
    version: "1.10.0",
    checks: { guacd: guacdOk, database: databaseOk },
  });
});

const clientDist = path.join(process.cwd(), "client", "dist");
app.use(
  express.static(clientDist, {
    setHeaders(res, filePath) {
      if (filePath.endsWith("index.html")) {
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      }
    },
  })
);
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api") || req.path.startsWith("/ws")) {
    next();
    return;
  }
  res.sendFile(path.join(clientDist, "index.html"), (err) => {
    if (err) next();
  });
});

const server = http.createServer(app);
const wss = new WebSocketServer({
  noServer: true,
  handleProtocols: (protocols) => {
    if (protocols.has("guacamole")) return "guacamole";
    return protocols.values().next().value ?? false;
  },
});

server.on("upgrade", (request, socket, head) => {
  const pathname = parseUrl(request.url ?? "").pathname ?? "";
  const hasCookie = Boolean(request.headers.cookie?.includes("bastion_token"));

  if (pathname === "/ws/ssh" || pathname === "/ws/guacd") {
    console.log(`[WS] Upgrade ${pathname} (cookie: ${hasCookie ? "oui" : "non"})`);
    wss.handleUpgrade(request, socket, head, (ws) => {
      if (pathname === "/ws/ssh") {
        handleSshConnection(ws, request);
      } else {
        handleGuacdConnection(ws, request, GUACD_HOST, GUACD_PORT);
      }
    });
  } else {
    console.log(`[WS] Upgrade refusé : ${pathname || request.url}`);
    socket.destroy();
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`
  ╔══════════════════════════════════════╗
  ║           B A S T I O N              ║
  ║   Passerelle d'accès distant         ║
  ╠══════════════════════════════════════╣
  ║  http://localhost:${String(PORT).padEnd(19)}║
  ║  Version : 1.10.0${" ".repeat(21)}║
  ║  Admin : ${ADMIN_USER.padEnd(27)}║
  ╚══════════════════════════════════════╝
  `);
});

export default app;
