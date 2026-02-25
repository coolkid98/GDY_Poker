import { Client, Room } from "colyseus.js";

let client: Client | null = null;
let room: Room | null = null;

const endpoint = import.meta.env.VITE_COLYSEUS_ENDPOINT ?? "ws://127.0.0.1:2567";

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
