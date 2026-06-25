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
import apiRouter from "./routes/api";
import { handleSshConnection } from "./ws/ssh";
import { handleGuacdConnection } from "./ws/guacd";

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

initDatabase(DATABASE_PATH);
ensureAdminUser(ADMIN_USER, ADMIN_PASSWORD);

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

app.use((req, _res, next) => {
  if (req.path.startsWith("/api") || req.path.startsWith("/ws")) {
    console.log(`[HTTP] ${req.method} ${req.originalUrl.split("?")[0]}`);
  }
  next();
});

app.use("/api", apiRouter);

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    name: "Bastion",
    version: "1.0.16",
    guacd: { host: GUACD_HOST, port: GUACD_PORT },
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

server.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════╗
  ║           B A S T I O N              ║
  ║   Passerelle d'accès distant         ║
  ╠══════════════════════════════════════╣
  ║  http://localhost:${String(PORT).padEnd(19)}║
  ║  Version : 1.0.16${" ".repeat(21)}║
  ║  Admin : ${ADMIN_USER.padEnd(27)}║
  ╚══════════════════════════════════════╝
  `);
});

export default app;
