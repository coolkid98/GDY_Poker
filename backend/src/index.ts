import http from "node:http";
import cors from "cors";
import express from "express";
import { Server } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { env } from "./config/env.js";
import { GdyRoom } from "./rooms/gdy-room.js";
import { RedisService } from "./services/redis-service.js";
import { AuthError, AuthService } from "./services/auth-service.js";

const bootstrap = async (): Promise<void> => {
  const app = express();
  app.use(cors());
  app.use(express.json());

  const redisService = new RedisService();
  if (env.redisUrl) {
    await redisService.connect(env.redisUrl);
  }
  const authService = new AuthService(redisService, env.authJwtSecret);

  app.post("/auth/register", async (req, res) => {
    try {
      const result = await authService.register({
        username: String(req.body?.username ?? ""),
        password: String(req.body?.password ?? ""),
        nickname: typeof req.body?.nickname === "string" ? req.body.nickname : undefined
      });
      res.status(201).json(result);
    } catch (error) {
      if (error instanceof AuthError) {
        res.status(error.status).json({
          ok: false,
          code: error.code,
          message: error.message
        });
        return;
      }
      res.status(500).json({
        ok: false,
        code: "AUTH_REGISTER_FAILED",
        message: "注册失败，请稍后重试"
      });
    }
  });

  app.post("/auth/login", async (req, res) => {
    try {
      const result = await authService.login({
        username: String(req.body?.username ?? ""),
        password: String(req.body?.password ?? "")
      });
      res.json(result);
    } catch (error) {
      if (error instanceof AuthError) {
        res.status(error.status).json({
          ok: false,
          code: error.code,
          message: error.message
        });
        return;
      }
      res.status(500).json({
        ok: false,
        code: "AUTH_LOGIN_FAILED",
        message: "登录失败，请稍后重试"
      });
    }
  });

  app.get("/healthz", (_req, res) => {
    res.json({
      ok: true,
      redis: redisService.isEnabled(),
      auth: true
    });
  });

  const server = http.createServer(app);

  const gameServer = new Server({
    transport: new WebSocketTransport({
      server
    })
  });

  gameServer.define("gdy_room", GdyRoom, {
    maxPlayers: env.roomMaxPlayers,
    redisService,
    authService
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
