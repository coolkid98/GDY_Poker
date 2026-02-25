import http from "node:http";
import cors from "cors";
import express from "express";
import { Server } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { env } from "./config/env.js";
import { GdyRoom } from "./rooms/gdy-room.js";
import { RedisService } from "./services/redis-service.js";

const bootstrap = async (): Promise<void> => {
  const app = express();
  app.use(cors());
  app.use(express.json());

  const redisService = new RedisService();
  if (env.redisUrl) {
    await redisService.connect(env.redisUrl);
  }

  app.get("/healthz", (_req, res) => {
    res.json({
      ok: true,
      redis: redisService.isEnabled()
    });
  });

  const server = http.createServer(app);

  const gameServer = new Server({
    transport: new WebSocketTransport({
      server
    })
  });

  gameServer.define("gdy_room", GdyRoom, {
    maxPlayers: env.roomMaxPlayers
  });

  server.listen(env.port, env.host, () => {
    // eslint-disable-next-line no-console
    console.log(`[backend] listening on http://${env.host}:${env.port}`);
  });

  const shutdown = async (): Promise<void> => {
    await redisService.disconnect();
    gameServer.gracefullyShutdown();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
};

bootstrap().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("[backend] bootstrap failed", error);
  process.exit(1);
});
