export interface UiPlayer {
  sessionId: string;
  nickname: string;
  seat: number;
  ready: boolean;
  connected: boolean;
  handCount: number;
  score: number;
}

export interface UiLastPlay {
  seat: number;
  declaredType: string;
  declaredKey: string;
  cardsCount: number;
}

export interface UiRoomState {
  roomId: string;
  status: string;
  dealerSeat: number;
  turnSeat: number;
  deckCount: number;
  passCount: number;
  lastPlay: UiLastPlay | null;
  players: UiPlayer[];
}
