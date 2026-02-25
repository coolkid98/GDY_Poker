import { create } from "zustand";
import type { UiPlayer, UiRoomState } from "../types/game-state";

interface GameStore {
  nickname: string;
  connected: boolean;
  roomId: string;
  sessionId: string;
  hand: string[];
  roomState: UiRoomState | null;
  logs: string[];
  setNickname: (name: string) => void;
  setConnected: (connected: boolean) => void;
  setRoomMeta: (roomId: string, sessionId: string) => void;
  setHand: (cards: string[]) => void;
  addHandCard: (cardId: string) => void;
  setRoomState: (state: UiRoomState) => void;
  appendLog: (line: string) => void;
  clearRoom: () => void;
}

const initialRoomState: UiRoomState | null = null;

export const normalizePlayers = (playersLike: Record<string, any> | undefined): UiPlayer[] => {
  if (!playersLike) {
    return [];
  }
  return Object.entries(playersLike).map(([sessionId, value]) => ({
    sessionId,
    nickname: String(value?.nickname ?? ""),
    seat: Number(value?.seat ?? -1),
    ready: Boolean(value?.ready),
    connected: Boolean(value?.connected),
    handCount: Number(value?.handCount ?? 0),
    score: Number(value?.score ?? 0)
  }));
};

export const useGameStore = create<GameStore>((set) => ({
  nickname: "",
  connected: false,
  roomId: "",
  sessionId: "",
  hand: [],
  roomState: initialRoomState,
  logs: [],
  setNickname: (name) => set({ nickname: name }),
  setConnected: (connected) => set({ connected }),
  setRoomMeta: (roomId, sessionId) => set({ roomId, sessionId }),
  setHand: (cards) => set({ hand: cards }),
  addHandCard: (cardId) => set((prev) => ({ hand: [...prev.hand, cardId] })),
  setRoomState: (state) => set({ roomState: state }),
  appendLog: (line) =>
    set((prev) => ({
      logs: [...prev.logs.slice(-59), line]
    })),
  clearRoom: () =>
    set({
      connected: false,
      roomId: "",
      sessionId: "",
      hand: [],
      roomState: initialRoomState,
      logs: []
    })
}));
