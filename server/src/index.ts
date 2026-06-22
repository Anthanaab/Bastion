import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import path from "path";
import http from "http";
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

app.use("/api", apiRouter);

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", name: "Bastion", version: "1.0.0" });
});

const clientDist = path.join(process.cwd(), "client", "dist");
app.use(express.static(clientDist));
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
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  const url = request.url ?? "";

  if (url.startsWith("/ws/ssh")) {
    wss.handleUpgrade(request, socket, head, (ws) => {
      handleSshConnection(ws, url);
    });
  } else if (url.startsWith("/ws/guacd")) {
    wss.handleUpgrade(request, socket, head, (ws) => {
      handleGuacdConnection(ws, url, GUACD_HOST, GUACD_PORT);
    });
  } else {
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
  ║  Admin : ${ADMIN_USER.padEnd(27)}║
  ╚══════════════════════════════════════╝
  `);
});

export default app;
