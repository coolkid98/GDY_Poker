import { Client, Room } from "colyseus.js";

let client: Client | null = null;
let room: Room | null = null;

const isLoopbackHost = (host: string): boolean => {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
};

const resolveEndpoint = (): string => {
  const configured = import.meta.env.VITE_COLYSEUS_ENDPOINT as string | undefined;
  if (!configured) {
    if (typeof window !== "undefined") {
      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      return `${protocol}://${window.location.hostname}:2567`;
    }
    return "ws://127.0.0.1:2567";
  }

  if (typeof window === "undefined") {
    return configured;
  }

  try {
    const parsed = new URL(configured);
    const browserHost = window.location.hostname;
    if (isLoopbackHost(parsed.hostname) && !isLoopbackHost(browserHost)) {
      parsed.hostname = browserHost;
      if (!parsed.port) {
        parsed.port = "2567";
      }
      return parsed.toString().replace(/\/$/, "");
    }
  } catch {
    return configured;
  }

  return configured;
};

const endpoint = resolveEndpoint();

export const getEndpoint = (): string => endpoint;

export const joinGameRoom = async (nickname: string): Promise<Room> => {
  if (!client) {
    client = new Client(endpoint);
  }
  room = await client.joinOrCreate("gdy_room", { nickname });
  return room;
};

export const getCurrentRoom = (): Room | null => room;

export const leaveGameRoom = async (): Promise<void> => {
  if (!room) {
    return;
  }
  await room.leave();
  room = null;
};
