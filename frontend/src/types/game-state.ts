export interface UiPlayer {
  sessionId: string;
  nickname: string;
  seat: number;
  ready: boolean;
  connected: boolean;
  handCount: number;
  score: number;
}

export interface UiRoomState {
  roomId: string;
  status: string;
  dealerSeat: number;
  turnSeat: number;
  deckCount: number;
  passCount: number;
  players: UiPlayer[];
}
