import express from "express";
import { createServer as createViteServer } from "vite";
import { WebSocketServer, WebSocket } from "ws";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // API routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Create HTTP server
  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  // WebSocket Server
  const wss = new WebSocketServer({ server });

  const clients = new Set<WebSocket>();
  const hardware = new Set<WebSocket>();

  wss.on("connection", (ws, req) => {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    const type = url.searchParams.get("type"); // "client" or "hardware"

    if (type === "hardware") {
      console.log("ESP8266 connected via WiFi");
      hardware.add(ws);
      ws.on("close", () => hardware.delete(ws));
    } else {
      console.log("Client connected via WebSocket");
      clients.add(ws);
      ws.on("close", () => clients.delete(ws));
    }

    ws.on("message", (data) => {
      const message = data.toString();
      console.log(`Received [${type}]: ${message}`);

      if (type === "client") {
        // Relay to hardware
        hardware.forEach((h) => {
          if (h.readyState === WebSocket.OPEN) {
            h.send(message);
          }
        });
      } else if (type === "hardware") {
        // Relay to clients
        clients.forEach((c) => {
          if (c.readyState === WebSocket.OPEN) {
            c.send(message);
          }
        });
      }
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*all", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }
}

startServer();
