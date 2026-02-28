import dotenv from "dotenv";

dotenv.config();

const toNumber = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const env = {
  port: toNumber(process.env.PORT, 2567),
  host: process.env.HOST ?? "0.0.0.0",
  redisUrl: process.env.REDIS_URL ?? "",
  roomMaxPlayers: toNumber(process.env.ROOM_MAX_PLAYERS, 10),
  authJwtSecret: process.env.AUTH_JWT_SECRET ?? "gdy_dev_jwt_secret_change_me"
};
