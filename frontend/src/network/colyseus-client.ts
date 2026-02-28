import { Client, Room } from "colyseus.js";

let client: Client | null = null;
let room: Room | null = null;

const USER_ID_STORAGE_KEY = "gdy:user-id";
const RECONNECT_META_STORAGE_KEY = "gdy:reconnect-meta";

interface ReconnectMeta {
  roomId: string;
  userId: string;
  reconnectToken: string;
}

const isLoopbackHost = (host: string): boolean => {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
};

const safeParseJson = <T>(input: string | null): T | null => {
  if (!input) {
    return null;
  }
  try {
    return JSON.parse(input) as T;
  } catch {
    return null;
  }
};

const createClientActionId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `u-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

const resolveUserId = (): string => {
  if (typeof window === "undefined") {
    return createClientActionId();
  }

  const fromSession = window.sessionStorage.getItem(USER_ID_STORAGE_KEY);
  if (fromSession) {
    return fromSession;
  }

  const nextUserId = createClientActionId();
  window.sessionStorage.setItem(USER_ID_STORAGE_KEY, nextUserId);
  return nextUserId;
};

const loadReconnectMeta = (): ReconnectMeta | null => {
  if (typeof window === "undefined") {
    return null;
  }
  return safeParseJson<ReconnectMeta>(window.localStorage.getItem(RECONNECT_META_STORAGE_KEY));
};

const saveReconnectMeta = (meta: ReconnectMeta): void => {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(RECONNECT_META_STORAGE_KEY, JSON.stringify(meta));
};

const clearReconnectMeta = (): void => {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(RECONNECT_META_STORAGE_KEY);
};

const bindReconnectTokenListener = (nextRoom: Room, userId: string): void => {
  nextRoom.onMessage("reconnect_token", (message: unknown) => {
    const payload = (message ?? {}) as {
      roomId?: string;
      userId?: string;
      reconnectToken?: string;
    };

    const reconnectToken = String(payload.reconnectToken ?? "");
    if (!reconnectToken) {
      return;
    }

    saveReconnectMeta({
      roomId: String(payload.roomId ?? nextRoom.roomId),
      userId: String(payload.userId ?? userId),
      reconnectToken
    });
  });
};

const tryReconnectRoom = async (nickname: string, userId: string): Promise<Room | null> => {
  if (!client) {
    return null;
  }

  const reconnectMeta = loadReconnectMeta();
  if (!reconnectMeta || !reconnectMeta.roomId || !reconnectMeta.reconnectToken) {
    return null;
  }

  if (reconnectMeta.userId !== userId) {
    clearReconnectMeta();
    return null;
  }

  try {
    return await client.joinById(reconnectMeta.roomId, {
      nickname,
      userId,
      reconnectToken: reconnectMeta.reconnectToken
    });
  } catch {
    clearReconnectMeta();
    return null;
  }
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

  const userId = resolveUserId();
  room = await tryReconnectRoom(nickname, userId);

  if (!room) {
    room = await client.joinOrCreate("gdy_room", { nickname, userId });
  }

  bindReconnectTokenListener(room, userId);
  room.send("request_reconnect_token");
  return room;
};

export const getCurrentRoom = (): Room | null => room;

export const leaveGameRoom = async (options?: { preserveReconnect?: boolean }): Promise<void> => {
  if (!room) {
    if (!options?.preserveReconnect) {
      clearReconnectMeta();
    }
    return;
  }
  await room.leave();
  room = null;
  if (!options?.preserveReconnect) {
    clearReconnectMeta();
  }
};
