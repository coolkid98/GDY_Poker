import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { HandPanel } from "../components/HandPanel";
import {
  getAudioEnabledPreference,
  playBombSfx,
  playCardSfx,
  playDrawSfx,
  setAudioEnabledPreference,
  startGameBackgroundMusic,
  stopGameBackgroundMusic,
  unlockGameAudio
} from "../audio/game-audio";
import { joinGameRoom, leaveGameRoom } from "../network/colyseus-client";
import { normalizePlayers, useGameStore } from "../store/use-game-store";
import type { UiLastPlay, UiPlayer } from "../types/game-state";
import { cardThemeClass, hasWildcard, sortCardIds, toCardLabel } from "../utils/cards";

const rankOptions = ["3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A", "2"];
const patternOptions = [
  { label: "单张", value: "single" },
  { label: "对子", value: "pair" },
  { label: "顺子", value: "straight" },
  { label: "炸弹", value: "bomb" }
];

const reasonMap: Record<string, string> = {
  TABLE_EMPTY_CANNOT_PASS: "当前无可跟牌型，先手不能过牌",
  GAME_NOT_PLAYING: "当前不在出牌阶段",
  NOT_YOUR_TURN: "还没轮到你出牌",
  WILDCARD_DECLARE_REQUIRED: "赖子牌型定型失败，请补充声明后重试",
  CANNOT_BEAT_LAST_PLAY: "这手牌无法压过上一手",
  INVALID_STRAIGHT: "顺子声明不合法",
  CARD_NOT_OWNED: "你出的牌不在手牌中",
  UNKNOWN_PATTERN: "牌型无法识别",
  INVALID_DECLARED_KEY: "声明的关键点数不合法",
  DUPLICATE_ACTION: "重复操作已忽略",
  MISSING_ACTION_ID: "缺少操作编号，请重试"
};

interface PlayedMessage {
  seat: number;
  cardsCount: number;
  cards: string[];
  declaredType: string;
  declaredKey: string;
}

interface PlayerDrewMessage {
  seat: number;
  cardsCount: number;
  deckCount: number;
  handCount: number;
}

interface SeatRecentPlay {
  cards: string[];
  declaredType: string;
  declaredKey: string;
  tick: number;
}

interface TableActionItem {
  id: string;
  seat: number;
  kind: "play" | "pass";
  cards: string[];
  declaredType?: string;
  declaredKey?: string;
}

interface SeatLayoutItem {
  player: UiPlayer;
  left: number;
  top: number;
}

interface ArenaBoardSize {
  width: number;
  height: number;
}

interface ArenaLayoutMetrics extends ArenaBoardSize {
  seatWidth: number;
  seatScale: number;
  cardScale: number;
  trailScale: number;
  radiusX: number;
  radiusY: number;
  tableWidthPercent: number;
  tableHeightPercent: number;
  tableTopPercent: number;
  tablePadX: number;
  tablePadY: number;
}

interface UiEventLog {
  id: string;
  text: string;
  kind: "system" | "play" | "pass" | "draw" | "settlement" | "error";
  cards?: string[];
}

interface PlayedVisualCard {
  id: string;
  seat: number;
  nickname: string;
  cardId: string;
}

interface DrawFlightItem {
  id: string;
  seat: number;
}

interface PlayFlightItem {
  id: string;
  seat: number;
  cardId: string;
  index: number;
}

interface BombFxState {
  tick: number;
  seat: number;
  key: string;
}

interface WinnerFxState {
  tick: number;
  seat: number;
  nickname: string;
}

const generateActionId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
};

const toPlayersLike = (input: unknown): Record<string, unknown> => {
  if (!input) {
    return {};
  }
  if (typeof input === "object" && input !== null && "forEach" in input && typeof (input as { forEach: unknown }).forEach === "function") {
    const output: Record<string, unknown> = {};
    (input as { forEach: (callback: (value: unknown, key: string) => void) => void }).forEach((value, key) => {
      output[key] = value;
    });
    return output;
  }
  return input as Record<string, unknown>;
};

const toArray = (input: unknown): string[] => {
  if (!input) {
    return [];
  }
  if (Array.isArray(input)) {
    return input as string[];
  }
  if (typeof input === "object" && input !== null && "forEach" in input && typeof (input as { forEach: unknown }).forEach === "function") {
    const result: string[] = [];
    (input as { forEach: (callback: (value: string) => void) => void }).forEach((value) => result.push(value));
    return result;
  }
  return [];
};

const formatCards = (cards: string[], limit: number): string => {
  const labels = cards.map((card) => toCardLabel(card));
  if (labels.length <= limit) {
    return labels.join(" ");
  }
  return `${labels.slice(0, limit).join(" ")} +${labels.length - limit}`;
};

const clampNumber = (value: number, min: number, max: number): number => {
  return Math.max(min, Math.min(max, value));
};

const computeArenaMetrics = (boardSize: ArenaBoardSize, playerCount: number): ArenaLayoutMetrics => {
  const width = Math.max(boardSize.width, 320);
  const height = Math.max(boardSize.height, 280);
  const isNarrowScreen = width <= 640;

  const compactByWidth = clampNumber((620 - width) / 260, 0, 1);
  const compactByHeight = clampNumber((660 - height) / 260, 0, 1);
  const compact = Math.max(compactByWidth, compactByHeight);

  const seatWidthFactor = isNarrowScreen ? 0.145 : 0.18;
  const seatWidthCompactDelta = isNarrowScreen ? 0.032 : 0.025;
  const seatWidth = clampNumber(width * (seatWidthFactor - compact * seatWidthCompactDelta), isNarrowScreen ? 52 : 64, 150);
  const seatScale = clampNumber(seatWidth / 150, 0.42, 1);
  const cardScale = clampNumber(1 - compact * 0.34 - (isNarrowScreen ? 0.08 : 0), 0.54, 1);
  const trailScale = clampNumber(1 - compact * 0.36, 0.56, 1);

  const tableWidthPercent = clampNumber(72 + compact * 10 - (isNarrowScreen ? 4 : 0), 70, 84);
  const tableHeightPercent = clampNumber(62 - compact * 12 - (isNarrowScreen ? 6 : 0), 42, 62);
  const tableTopPercent = clampNumber(50 + compact * 4 + (isNarrowScreen ? 2 : 0), 50, 56);
  const tablePadX = clampNumber(30 - compact * 18, 10, 30);
  const tablePadY = clampNumber(18 - compact * 10, 6, 18);

  const seatHeight = seatWidth * 1.02;
  const maxRadiusX = Math.max(width / 2 - (seatWidth / 2 + 10), 10);
  const maxRadiusY = Math.max(height / 2 - (seatHeight / 2 + 10), 10);

  let baseRadiusXRatio = 0;
  let baseRadiusYRatio = 0.7;
  if (playerCount <= 2) {
    baseRadiusXRatio = 0;
    baseRadiusYRatio = 0.82;
  } else if (playerCount === 3) {
    baseRadiusXRatio = 0.9;
    baseRadiusYRatio = 0.92;
  } else if (playerCount === 4) {
    baseRadiusXRatio = 0.86;
    baseRadiusYRatio = 0.84;
  } else if (playerCount <= 4) {
    baseRadiusXRatio = 0.84;
    baseRadiusYRatio = 0.78;
  } else if (playerCount <= 6) {
    baseRadiusXRatio = 0.9;
    baseRadiusYRatio = 0.86;
  } else {
    baseRadiusXRatio = 0.92;
    baseRadiusYRatio = 0.88;
  }

  const mobileRadiusBoostX = isNarrowScreen ? 0.1 : 0;
  const mobileRadiusBoostY = isNarrowScreen ? 0.14 : 0;
  const radiusXRatio = clampNumber(baseRadiusXRatio - compact * 0.05 + mobileRadiusBoostX, 0.68, 0.98);
  const radiusYRatio = clampNumber(baseRadiusYRatio - compact * 0.06 + mobileRadiusBoostY, 0.64, 1);

  const radiusX = playerCount <= 2 ? 0 : maxRadiusX * radiusXRatio;
  const radiusY = maxRadiusY * radiusYRatio;

  return {
    width,
    height,
    seatWidth,
    seatScale,
    cardScale,
    trailScale,
    radiusX,
    radiusY,
    tableWidthPercent,
    tableHeightPercent,
    tableTopPercent,
    tablePadX,
    tablePadY
  };
};

const getPresetSeatAngles = (count: number): number[] | null => {
  if (count === 1) {
    return [90];
  }
  if (count === 2) {
    return [90, 270];
  }
  if (count === 3) {
    return [90, 300, 240];
  }
  if (count === 4) {
    return [90, 20, 290, 160];
  }
  return null;
};

const buildSeatLayout = (players: UiPlayer[], mySeat: number | null, metrics: ArenaLayoutMetrics): SeatLayoutItem[] => {
  if (players.length === 0) {
    return [];
  }

  const sorted = [...players].sort((a, b) => a.seat - b.seat);
  const myIndex = mySeat === null ? -1 : sorted.findIndex((player) => player.seat === mySeat);
  const step = 360 / sorted.length;
  const baseStartDeg = -90;
  const rotation = myIndex >= 0 ? 90 - (baseStartDeg + step * myIndex) : 0;
  const presetAngles = myIndex >= 0 ? getPresetSeatAngles(sorted.length) : null;

  return sorted.map((player, index) => {
    let angleDeg = baseStartDeg + step * index + rotation;
    if (presetAngles && presetAngles.length === sorted.length) {
      const relativeIndex = (index - myIndex + sorted.length) % sorted.length;
      angleDeg = presetAngles[relativeIndex] ?? angleDeg;
    }

    const angle = (angleDeg * Math.PI) / 180;
    const leftPx = metrics.width / 2 + Math.cos(angle) * metrics.radiusX;
    const topPx = metrics.height / 2 + Math.sin(angle) * metrics.radiusY;
    const leftPercent = clampNumber((leftPx / metrics.width) * 100, 2, 98);
    const topPercent = clampNumber((topPx / metrics.height) * 100, 2, 98);

    return {
      player,
      left: leftPercent,
      top: topPercent
    };
  });
};

const actionText = (action: TableActionItem): string => {
  if (action.kind === "pass") {
    return `座${action.seat} 过牌`;
  }
  const cards = formatCards(action.cards, 3);
  return `座${action.seat} ${action.declaredType ?? ""}:${action.declaredKey ?? ""} ${cards}`.trim();
};

export const RoomPage = (): JSX.Element => {
  const navigate = useNavigate();
  const [selectedCards, setSelectedCards] = useState<string[]>([]);
  const [declaredType, setDeclaredType] = useState("single");
  const [declaredKey, setDeclaredKey] = useState("");
  const [roomRef, setRoomRef] = useState<any>(null);
  const [eventLogs, setEventLogs] = useState<UiEventLog[]>([]);
  const [mobileInfoOpen, setMobileInfoOpen] = useState(false);
  const [mobileInfoTab, setMobileInfoTab] = useState<"logs" | "played">("logs");

  const [tablePlayView, setTablePlayView] = useState<UiLastPlay | null>(null);
  const [tableAnimTick, setTableAnimTick] = useState(0);
  const [drawBanner, setDrawBanner] = useState<{ seat: number; tick: number } | null>(null);
  const [drawPulseSeats, setDrawPulseSeats] = useState<Record<number, number>>({});
  const [deckPulse, setDeckPulse] = useState(false);
  const [incomingCardId, setIncomingCardId] = useState<string | null>(null);
  const [incomingPulseTick, setIncomingPulseTick] = useState(0);
  const [seatRecentPlays, setSeatRecentPlays] = useState<Record<number, SeatRecentPlay>>({});
  const [tableActions, setTableActions] = useState<TableActionItem[]>([]);
  const [playedVisualCards, setPlayedVisualCards] = useState<PlayedVisualCard[]>([]);
  const [drawFlights, setDrawFlights] = useState<DrawFlightItem[]>([]);
  const [playFlights, setPlayFlights] = useState<PlayFlightItem[]>([]);
  const [bombFx, setBombFx] = useState<BombFxState | null>(null);
  const [winnerFx, setWinnerFx] = useState<WinnerFxState | null>(null);
  const [audioEnabled, setAudioEnabled] = useState<boolean>(() => getAudioEnabledPreference());
  const audioGestureArmedRef = useRef(true);

  const arenaBoardRef = useRef<HTMLDivElement | null>(null);
  const [arenaBoardSize, setArenaBoardSize] = useState<ArenaBoardSize>({
    width: 960,
    height: 640
  });

  const drawPulseTimersRef = useRef<Record<number, number>>({});
  const drawBannerTimerRef = useRef<number | null>(null);
  const deckPulseTimerRef = useRef<number | null>(null);
  const incomingCardTimerRef = useRef<number | null>(null);
  const flightTimersRef = useRef<Record<string, number>>({});
  const playFlightTimersRef = useRef<Record<string, number>>({});
  const bombFxTimerRef = useRef<number | null>(null);
  const winnerFxTimerRef = useRef<number | null>(null);

  const { nickname, sessionId, roomState, hand, setConnected, setRoomMeta, setHand, setRoomState, appendLog, clearRoom } =
    useGameStore();

  const primeAudioByGesture = useCallback((): void => {
    if (!audioEnabled || !audioGestureArmedRef.current) {
      return;
    }
    audioGestureArmedRef.current = false;
    void unlockGameAudio().then((ok) => {
      if (ok && audioEnabled) {
        startGameBackgroundMusic();
      }
    });
  }, [audioEnabled]);

  const toggleAudio = useCallback((): void => {
    const next = !audioEnabled;
    setAudioEnabled(next);
    setAudioEnabledPreference(next);
    if (!next) {
      stopGameBackgroundMusic();
      return;
    }
    audioGestureArmedRef.current = false;
    void unlockGameAudio().then((ok) => {
      if (ok) {
        startGameBackgroundMusic();
      }
    });
  }, [audioEnabled]);

  const resolveSeatName = useCallback((seat: number): string => {
    const players = useGameStore.getState().roomState?.players ?? [];
    return players.find((player) => player.seat === seat)?.nickname ?? `玩家${seat}`;
  }, []);

  const seatWithName = useCallback(
    (seat: number): string => {
      return `座位 ${seat}（${resolveSeatName(seat)}）`;
    },
    [resolveSeatName]
  );

  const pushEventLog = useCallback(
    (payload: Omit<UiEventLog, "id">): void => {
      const entry: UiEventLog = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        ...payload
      };
      setEventLogs((prev) => [...prev.slice(-79), entry]);
      appendLog(payload.text);
    },
    [appendLog]
  );

  useEffect(() => {
    const boardEl = arenaBoardRef.current;
    if (!boardEl) {
      return;
    }

    const commitSize = (width: number, height: number): void => {
      const nextWidth = Math.max(1, Math.round(width));
      const nextHeight = Math.max(1, Math.round(height));
      setArenaBoardSize((prev) => {
        if (prev.width === nextWidth && prev.height === nextHeight) {
          return prev;
        }
        return {
          width: nextWidth,
          height: nextHeight
        };
      });
    };

    const syncFromRect = (rect: Pick<DOMRectReadOnly, "width" | "height">): void => {
      commitSize(rect.width, rect.height);
    };

    syncFromRect(boardEl.getBoundingClientRect());

    if (typeof ResizeObserver === "function") {
      const observer = new ResizeObserver((entries) => {
        const first = entries[0];
        if (first) {
          syncFromRect(first.contentRect);
        }
      });
      observer.observe(boardEl);
      return () => observer.disconnect();
    }

    const onResize = (): void => {
      syncFromRect(boardEl.getBoundingClientRect());
    };

    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, []);

  useEffect(() => {
    return () => {
      Object.values(drawPulseTimersRef.current).forEach((timerId) => {
        window.clearTimeout(timerId);
      });
      if (drawBannerTimerRef.current !== null) {
        window.clearTimeout(drawBannerTimerRef.current);
      }
      if (deckPulseTimerRef.current !== null) {
        window.clearTimeout(deckPulseTimerRef.current);
      }
      if (incomingCardTimerRef.current !== null) {
        window.clearTimeout(incomingCardTimerRef.current);
      }
      if (bombFxTimerRef.current !== null) {
        window.clearTimeout(bombFxTimerRef.current);
      }
      if (winnerFxTimerRef.current !== null) {
        window.clearTimeout(winnerFxTimerRef.current);
      }
      Object.values(flightTimersRef.current).forEach((timerId) => {
        window.clearTimeout(timerId);
      });
      Object.values(playFlightTimersRef.current).forEach((timerId) => {
        window.clearTimeout(timerId);
      });
      flightTimersRef.current = {};
      playFlightTimersRef.current = {};
    };
  }, []);

  useEffect(() => {
    setAudioEnabledPreference(audioEnabled);
    if (!audioEnabled) {
      stopGameBackgroundMusic();
      return;
    }

    let active = true;
    void unlockGameAudio().then((ok) => {
      if (active && ok) {
        startGameBackgroundMusic();
      }
    });

    return () => {
      active = false;
      stopGameBackgroundMusic();
    };
  }, [audioEnabled]);

  useEffect(() => {
    if (!nickname) {
      navigate("/", { replace: true });
      return;
    }

    const triggerDrawEffects = (seat: number): void => {
      playDrawSfx();
      setDrawPulseSeats((prev) => ({
        ...prev,
        [seat]: Date.now()
      }));

      const existingPulseTimer = drawPulseTimersRef.current[seat];
      if (existingPulseTimer) {
        window.clearTimeout(existingPulseTimer);
      }
      drawPulseTimersRef.current[seat] = window.setTimeout(() => {
        setDrawPulseSeats((prev) => {
          const next = { ...prev };
          delete next[seat];
          return next;
        });
        delete drawPulseTimersRef.current[seat];
      }, 1200);

      setDrawBanner({ seat, tick: Date.now() });
      if (drawBannerTimerRef.current !== null) {
        window.clearTimeout(drawBannerTimerRef.current);
      }
      drawBannerTimerRef.current = window.setTimeout(() => {
        setDrawBanner(null);
      }, 1200);

      setDeckPulse(false);
      window.setTimeout(() => {
        setDeckPulse(true);
      }, 0);
      if (deckPulseTimerRef.current !== null) {
        window.clearTimeout(deckPulseTimerRef.current);
      }
      deckPulseTimerRef.current = window.setTimeout(() => {
        setDeckPulse(false);
      }, 760);

      const flightId = `f-${seat}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      setDrawFlights((prev) => [...prev.slice(-5), { id: flightId, seat }]);
      flightTimersRef.current[flightId] = window.setTimeout(() => {
        setDrawFlights((prev) => prev.filter((item) => item.id !== flightId));
        delete flightTimersRef.current[flightId];
      }, 760);
    };

    let mounted = true;
    let joinedRoom: any = null;

    joinGameRoom(nickname)
      .then((room) => {
        if (!mounted) {
          void room.leave();
          return;
        }

        joinedRoom = room;
        setRoomRef(room);
        setConnected(true);
        setRoomMeta(room.roomId, room.sessionId);
        pushEventLog({
          kind: "system",
          text: `已进入房间 ${room.roomId}，我的 sessionId=${room.sessionId}`
        });

        room.onStateChange((rawState: any) => {
          const players = normalizePlayers(toPlayersLike(rawState.players)).sort((a, b) => a.seat - b.seat);
          const lastPlayCards = toArray(rawState.lastPlay?.cards);
          const hasLastPlay = Number(rawState.lastPlay?.seat ?? -1) >= 0 && lastPlayCards.length > 0;
          const nextStatus = String(rawState.status ?? "");

          const nextLastPlay: UiLastPlay | null = hasLastPlay
            ? {
                seat: Number(rawState.lastPlay?.seat ?? -1),
                declaredType: String(rawState.lastPlay?.declaredType ?? ""),
                declaredKey: String(rawState.lastPlay?.declaredKey ?? ""),
                cardsCount: lastPlayCards.length,
                cards: [...lastPlayCards]
              }
            : null;

          setRoomState({
            roomId: String(rawState.roomId ?? room.roomId),
            status: nextStatus,
            dealerSeat: Number(rawState.dealerSeat ?? -1),
            turnSeat: Number(rawState.turnSeat ?? -1),
            deckCount: Number(rawState.deckCount ?? 0),
            passCount: Number(rawState.passCount ?? 0),
            lastPlay: nextLastPlay,
            players
          });

          if (nextLastPlay) {
            setTablePlayView(nextLastPlay);
            return;
          }
          if (nextStatus === "PLAYING") {
            setTablePlayView(null);
          }
        });

        room.onMessage("hand_dealt", (message: { cards: string[] }) => {
          setHand(sortCardIds(message.cards ?? []));
          setSelectedCards([]);
          setIncomingCardId(null);
          setTablePlayView(null);
          setSeatRecentPlays({});
          setTableActions([]);
          setPlayedVisualCards([]);
          setDrawFlights([]);
          setPlayFlights([]);
          Object.values(playFlightTimersRef.current).forEach((timerId) => window.clearTimeout(timerId));
          playFlightTimersRef.current = {};
          setBombFx(null);
          if (winnerFxTimerRef.current !== null) {
            window.clearTimeout(winnerFxTimerRef.current);
            winnerFxTimerRef.current = null;
          }
          setWinnerFx(null);
          pushEventLog({
            kind: "system",
            text: `收到发牌：${message.cards?.length ?? 0} 张`
          });
        });

        room.onMessage("draw_card", (message: { cardId: string }) => {
          const current = useGameStore.getState().hand;
          setHand(sortCardIds([...current, message.cardId]));

          setIncomingCardId(message.cardId);
          setIncomingPulseTick((tick) => tick + 1);
          if (incomingCardTimerRef.current !== null) {
            window.clearTimeout(incomingCardTimerRef.current);
          }
          incomingCardTimerRef.current = window.setTimeout(() => {
            setIncomingCardId(null);
          }, 900);

          pushEventLog({
            kind: "draw",
            text: `你摸牌：${toCardLabel(message.cardId)}`,
            cards: [message.cardId]
          });
        });

        room.onMessage("hand_sync", (message: { cards: string[] }) => {
          setHand(sortCardIds(message.cards ?? []));
        });

        room.onMessage("action_result", (message: { ok: boolean; reason?: string }) => {
          if (!message.ok) {
            const readable = reasonMap[message.reason ?? ""] ?? message.reason ?? "UNKNOWN";
            pushEventLog({
              kind: "error",
              text: `操作失败：${readable}`
            });
          }
        });

        room.onMessage("played", (message: PlayedMessage) => {
          const cards = sortCardIds(message.cards ?? []);
          const seatName = resolveSeatName(message.seat);
          setWinnerFx(null);
          setTablePlayView({
            seat: message.seat,
            declaredType: message.declaredType,
            declaredKey: message.declaredKey,
            cardsCount: cards.length,
            cards
          });
          setTableAnimTick((tick) => tick + 1);

          setSeatRecentPlays((prev) => ({
            ...prev,
            [message.seat]: {
              cards,
              declaredType: message.declaredType,
              declaredKey: message.declaredKey,
              tick: Date.now()
            }
          }));
          setTableActions((prev) => [
            ...prev.slice(-11),
            {
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              seat: message.seat,
              kind: "play",
              cards,
              declaredType: message.declaredType,
              declaredKey: message.declaredKey
            }
          ]);
          setPlayedVisualCards((prev) => {
            const appended = cards.map((cardId, index) => ({
              id: `${Date.now()}-${message.seat}-${index}-${Math.random().toString(36).slice(2, 6)}`,
              seat: message.seat,
              nickname: seatName,
              cardId
            }));
            return [...prev, ...appended].slice(-300);
          });

          const now = Date.now();
          const flights = cards.map((cardId, index) => ({
            id: `pf-${now}-${message.seat}-${index}-${Math.random().toString(36).slice(2, 6)}`,
            seat: message.seat,
            cardId,
            index
          }));
          setPlayFlights((prev) => [...prev.slice(-24), ...flights]);
          for (const flight of flights) {
            const timeout = window.setTimeout(
              () => {
                setPlayFlights((prev) => prev.filter((item) => item.id !== flight.id));
                delete playFlightTimersRef.current[flight.id];
              },
              560 + flight.index * 70
            );
            playFlightTimersRef.current[flight.id] = timeout;
          }

          if (message.declaredType === "bomb") {
            playBombSfx();
            setBombFx({
              tick: Date.now(),
              seat: message.seat,
              key: message.declaredKey
            });
            if (bombFxTimerRef.current !== null) {
              window.clearTimeout(bombFxTimerRef.current);
            }
            bombFxTimerRef.current = window.setTimeout(() => {
              setBombFx(null);
            }, 900);
          } else {
            playCardSfx(cards.length);
          }

          pushEventLog({
            kind: "play",
            text: `${seatWithName(message.seat)} 出牌 ${cards.length} 张（${message.declaredType}:${message.declaredKey}）`,
            cards
          });
        });

        room.onMessage("player_drew", (message: PlayerDrewMessage) => {
          triggerDrawEffects(message.seat);

          const store = useGameStore.getState();
          const me = store.roomState?.players.find((player) => player.sessionId === store.sessionId);
          if (me?.seat !== message.seat) {
            pushEventLog({
              kind: "draw",
              text: `${seatWithName(message.seat)} 摸了 ${message.cardsCount} 张牌`
            });
          }
        });

        room.onMessage("passed", (message: { seat: number }) => {
          setTableActions((prev) => [
            ...prev.slice(-11),
            {
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              seat: message.seat,
              kind: "pass",
              cards: []
            }
          ]);
          pushEventLog({
            kind: "pass",
            text: `${seatWithName(message.seat)} 过牌`
          });
        });

        room.onMessage("round_reset", (message: { turnSeat: number }) => {
          setTablePlayView(null);
          setTableAnimTick((tick) => tick + 1);
          setSeatRecentPlays({});
          setTableActions([]);
          setPlayFlights([]);
          Object.values(playFlightTimersRef.current).forEach((timerId) => window.clearTimeout(timerId));
          playFlightTimersRef.current = {};
          setBombFx(null);
          if (winnerFxTimerRef.current !== null) {
            window.clearTimeout(winnerFxTimerRef.current);
            winnerFxTimerRef.current = null;
          }
          setWinnerFx(null);
          pushEventLog({
            kind: "system",
            text: `新一轮开始，${seatWithName(message.turnSeat)} 先手`
          });
        });

        room.onMessage("settlement", (message: { winnerSeat: number }) => {
          setBombFx(null);
          setPlayFlights([]);
          Object.values(playFlightTimersRef.current).forEach((timerId) => window.clearTimeout(timerId));
          playFlightTimersRef.current = {};
          if (winnerFxTimerRef.current !== null) {
            window.clearTimeout(winnerFxTimerRef.current);
          }
          setWinnerFx({
            tick: Date.now(),
            seat: message.winnerSeat,
            nickname: resolveSeatName(message.winnerSeat)
          });
          winnerFxTimerRef.current = window.setTimeout(() => {
            setWinnerFx(null);
            winnerFxTimerRef.current = null;
          }, 2200);
          pushEventLog({
            kind: "settlement",
            text: `本局结算，赢家 ${seatWithName(message.winnerSeat)}`
          });
        });

        room.onLeave(() => {
          const store = useGameStore.getState();
          const me = store.roomState?.players.find((player) => player.sessionId === store.sessionId);
          if (me) {
            pushEventLog({
              kind: "system",
              text: `已离开房间：座位 ${me.seat}（${me.nickname}）`
            });
          } else {
            pushEventLog({
              kind: "system",
              text: `已离开房间（${nickname}）`
            });
          }
          setConnected(false);
        });
      })
      .catch((error: unknown) => {
        pushEventLog({
          kind: "error",
          text: `入房失败: ${String(error)}`
        });
        navigate("/", { replace: true });
      });

    return () => {
      mounted = false;
      if (joinedRoom) {
        void leaveGameRoom();
      }
    };
  }, [navigate, nickname, pushEventLog, resolveSeatName, seatWithName, setConnected, setHand, setRoomMeta, setRoomState]);

  const myPlayer = useMemo(() => {
    if (!roomState) {
      return null;
    }
    return roomState.players.find((player) => player.sessionId === sessionId) ?? null;
  }, [roomState, sessionId]);

  const isPlaying = roomState?.status === "PLAYING";
  const isMyTurn = Boolean(isPlaying && myPlayer && roomState.turnSeat === myPlayer.seat);
  const hasLastPlay = Boolean(roomState?.lastPlay);
  const selectedHasWildcard = hasWildcard(selectedCards);

  const readyDisabled = roomState?.status === "PLAYING" || roomState?.status === "DEALING";
  const isReadySelf = Boolean(myPlayer?.ready);
  const passDisabled = !isMyTurn || !hasLastPlay;
  const playDisabled = !isMyTurn || selectedCards.length === 0;
  const replayDisabled = roomState?.status !== "READY" || !myPlayer || myPlayer.ready;
  const showReadyBadgeInSidebar = roomState?.status === "WAITING" || roomState?.status === "READY";
  const showReadyOnTableSeat = roomState?.status === "WAITING" || roomState?.status === "READY";

  const tablePlay = tablePlayView ?? roomState?.lastPlay ?? null;
  const players = roomState?.players ?? [];
  const arenaLayout = useMemo(() => computeArenaMetrics(arenaBoardSize, players.length), [arenaBoardSize, players.length]);
  const seatLayout = useMemo(
    () => buildSeatLayout(players, myPlayer?.seat ?? null, arenaLayout),
    [players, myPlayer?.seat, arenaLayout]
  );
  const arenaBoardStyle = useMemo(
    () =>
      ({
        "--arena-seat-scale": arenaLayout.seatScale.toFixed(4),
        "--arena-card-scale": arenaLayout.cardScale.toFixed(4),
        "--arena-trail-scale": arenaLayout.trailScale.toFixed(4),
        "--arena-seat-width": `${Math.round(arenaLayout.seatWidth)}px`,
        "--arena-table-width": `${arenaLayout.tableWidthPercent.toFixed(2)}%`,
        "--arena-table-height": `${arenaLayout.tableHeightPercent.toFixed(2)}%`,
        "--arena-table-top": `${arenaLayout.tableTopPercent.toFixed(2)}%`,
        "--arena-table-pad-x": `${Math.round(arenaLayout.tablePadX)}px`,
        "--arena-table-pad-y": `${Math.round(arenaLayout.tablePadY)}px`
      }) as CSSProperties,
    [arenaLayout]
  );
  const seatPositionMap = useMemo(() => {
    const map: Record<number, { left: number; top: number }> = {};
    for (const seat of seatLayout) {
      map[seat.player.seat] = {
        left: seat.left,
        top: seat.top
      };
    }
    return map;
  }, [seatLayout]);
  const seatLatestAction = useMemo(() => {
    const map: Record<number, TableActionItem> = {};
    for (const action of tableActions) {
      map[action.seat] = action;
    }
    return map;
  }, [tableActions]);
  const playedCountBySeat = useMemo(() => {
    const map: Record<number, number> = {};
    for (const item of playedVisualCards) {
      map[item.seat] = (map[item.seat] ?? 0) + 1;
    }
    return map;
  }, [playedVisualCards]);

  const toggleCard = (cardId: string): void => {
    setSelectedCards((prev) => {
      const next = prev.includes(cardId) ? prev.filter((id) => id !== cardId) : [...prev, cardId];
      return sortCardIds(next);
    });
  };

  const sendReady = (ready: boolean): void => {
    primeAudioByGesture();
    roomRef?.send("ready", { ready });
  };

  const sendPass = (): void => {
    if (passDisabled) {
      return;
    }
    primeAudioByGesture();
    roomRef?.send("pass", {
      actionId: generateActionId(),
      seq: Date.now()
    });
  };

  const sendPlay = (): void => {
    if (playDisabled) {
      return;
    }
    primeAudioByGesture();
    const payload: Record<string, unknown> = {
      actionId: generateActionId(),
      seq: Date.now(),
      cards: selectedCards
    };
    if (selectedHasWildcard && declaredKey) {
      payload.declaredType = declaredType;
      payload.declaredKey = declaredKey.toUpperCase();
    }
    roomRef?.send("play_cards", payload);
    setSelectedCards([]);
  };

  const sendReplayReady = (): void => {
    if (replayDisabled) {
      return;
    }
    primeAudioByGesture();
    roomRef?.send("ready", { ready: true });
    if (myPlayer) {
      pushEventLog({
        kind: "system",
        text: `你已选择同房间再开一把：座位 ${myPlayer.seat}（${myPlayer.nickname}）已准备`
      });
    }
  };

  const leaveRoom = async (): Promise<void> => {
    setMobileInfoOpen(false);
    await leaveGameRoom();
    clearRoom();
    navigate("/", { replace: true });
  };

  const openInfoPanel = (tab: "logs" | "played"): void => {
    setMobileInfoTab(tab);
    setMobileInfoOpen(true);
  };

  const closeInfoPanel = (): void => {
    setMobileInfoOpen(false);
  };

  return (
    <main className="page page-room" onPointerDownCapture={primeAudioByGesture}>
      <button
        type="button"
        className={`mobile-info-backdrop ${mobileInfoOpen ? "open" : ""}`}
        onClick={closeInfoPanel}
        aria-label="关闭战斗信息"
      />

      <section className="panel hero-panel room-hero">
        <div className="toolbar">
          <h2>房间：{roomState?.roomId ?? "-"}</h2>
          <div className="toolbar-actions">
            <button type="button" className="ghost-btn info-trigger-btn mobile-only" onClick={() => openInfoPanel("logs")}>
              战斗信息
            </button>
            <button type="button" className={`ghost-btn audio-toggle-btn ${audioEnabled ? "active" : ""}`} onClick={toggleAudio}>
              {audioEnabled ? "音乐/音效 开" : "音乐/音效 关"}
            </button>
            <button type="button" className="ghost-btn" onClick={leaveRoom}>
              退出房间
            </button>
          </div>
        </div>
        <div className="status-row">
          <span className="status-pill">状态 {roomState?.status ?? "-"}</span>
          <span className={`status-pill ${deckPulse ? "deck-pulse" : ""}`}>牌堆 {roomState?.deckCount ?? 0}</span>
          <span className="status-pill">当前回合座位 {roomState?.turnSeat ?? "-"}</span>
          <span className="status-pill">我的座位 {myPlayer?.seat ?? "-"}</span>
        </div>

        <div className="action-wrap">
          <button
            type="button"
            className={`ready-btn ${isReadySelf ? "active" : ""}`}
            disabled={readyDisabled}
            onClick={() => sendReady(true)}
          >
            {isReadySelf ? "已准备 ✅" : "准备"}
          </button>
          <button type="button" disabled={readyDisabled} onClick={() => sendReady(false)}>
            取消准备
          </button>
          <button type="button" className="replay-btn" disabled={replayDisabled} onClick={sendReplayReady}>
            同房间再开一把
          </button>
          <button type="button" className="hero-turn-btn" disabled={passDisabled} onClick={sendPass}>
            过牌
          </button>
          <button type="button" className="hero-turn-btn" disabled={playDisabled} onClick={sendPlay}>
            出牌
          </button>
          <button type="button" className="ghost-btn" onClick={() => setSelectedCards([])}>
            清空选择
          </button>
        </div>

        <p className="hint-line">
          {isMyTurn ? "轮到你出牌" : "等待其他玩家操作"} | 已选 {selectedCards.length} 张
        </p>

        {selectedHasWildcard && (
          <div className="field-row">
            <label>
              牌型声明（可选）
              <select value={declaredType} onChange={(e) => setDeclaredType(e.target.value)}>
                {patternOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              关键点数（可选）
              <select value={declaredKey} onChange={(e) => setDeclaredKey(e.target.value)}>
                <option value="">请选择</option>
                {rankOptions
                  .filter((rank) => !(declaredType === "straight" && rank === "2"))
                  .map((rank) => (
                    <option key={rank} value={rank}>
                      {rank}
                    </option>
                  ))}
              </select>
            </label>
          </div>
        )}
      </section>

      <section className="panel battle-layout room-battle">
        <div className="arena-zone">
          <div className="arena-board" ref={arenaBoardRef} style={arenaBoardStyle}>
            <div className="arena-table">
              <div className="table-stage-head">
                <h4>桌面出牌区</h4>
                {drawBanner && (
                  <span key={`draw-${drawBanner.tick}`} className="draw-banner">
                    {seatWithName(drawBanner.seat)} 摸了 1 张牌
                  </span>
                )}
              </div>

              <div className="table-current">
                {!tablePlay ? (
                  <p className="muted">当前无可跟牌型</p>
                ) : (
                  <>
                    <p className="muted">
                      座位 {tablePlay.seat} | {tablePlay.cardsCount} 张 | {tablePlay.declaredType}:{tablePlay.declaredKey}
                    </p>
                    <div className="table-cards" key={`play-${tableAnimTick}-${tablePlay.seat}-${tablePlay.cards.join("|")}`}>
                      {tablePlay.cards.map((cardId, index) => (
                        <div
                          key={`${tableAnimTick}-${cardId}-${index}`}
                          className={`table-card ${cardThemeClass(cardId)} play-enter`}
                          style={{ animationDelay: `${index * 70}ms` }}
                        >
                          <span className="table-card-main">{toCardLabel(cardId)}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>

              <div className="table-history">
                <span className="table-history-title">本轮出牌轨迹</span>
                <div className="table-history-list">
                  {tableActions.length === 0 ? (
                    <span className="trail-empty">暂无动作</span>
                  ) : (
                    tableActions.map((action) => (
                      <span key={action.id} className={`trail-item ${action.kind}`}>
                        {actionText(action)}
                      </span>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="draw-flight-layer">
              {drawFlights.map((flight) => {
                const position = seatPositionMap[flight.seat] ?? { left: 50, top: 50 };
                const style = {
                  "--to-left": `${position.left}%`,
                  "--to-top": `${position.top}%`
                } as CSSProperties;

                return <div key={flight.id} className="draw-flight-card" style={style} />;
              })}
            </div>

            <div className="play-flight-layer">
              {playFlights.map((flight) => {
                const from = seatPositionMap[flight.seat] ?? { left: 50, top: 50 };
                const style = {
                  "--from-left": `${from.left}%`,
                  "--from-top": `${from.top}%`,
                  animationDelay: `${flight.index * 70}ms`
                } as CSSProperties;
                return (
                  <div key={flight.id} className={`play-flight-card ${cardThemeClass(flight.cardId)}`} style={style}>
                    {toCardLabel(flight.cardId)}
                  </div>
                );
              })}
            </div>

            {bombFx && (
              <div key={`bomb-${bombFx.tick}`} className="bomb-effect" aria-hidden="true">
                <span className="bomb-flash" />
                <span className="bomb-ripple bomb-ripple-a" />
                <span className="bomb-ripple bomb-ripple-b" />
                <span className="bomb-core">BOMB</span>
                <span className="bomb-text">
                  {seatWithName(bombFx.seat)} 炸弹 · {bombFx.key}
                </span>
              </div>
            )}

            {winnerFx && (
              <div key={`winner-${winnerFx.tick}`} className="winner-banner" aria-live="polite">
                {seatWithName(winnerFx.seat)} 出光手牌，获胜！
              </div>
            )}

            {seatLayout.map((seat) => {
              const player = seat.player;
              const isMe = player.sessionId === myPlayer?.sessionId;
              const isTurnSeat = player.seat === roomState?.turnSeat;
              const isDrawPulse = Boolean(drawPulseSeats[player.seat]);
              const isWinnerSeat = winnerFx?.seat === player.seat;
              const isReady = player.ready;
              const showReadyNow = Boolean(showReadyOnTableSeat);
              const recent = seatRecentPlays[player.seat];
              const seatLastText = isTurnSeat ? "出牌中" : recent ? formatCards(recent.cards, 2) : "未出牌";
              const visibleHandCardCount = Math.min(player.handCount, 12);
              const hiddenHandCardCount = Math.max(player.handCount - visibleHandCardCount, 0);
              const seatClasses = [
                "arena-seat",
                isMe ? "me" : "",
                isTurnSeat ? "turn" : "",
                isDrawPulse ? "drew" : "",
                isWinnerSeat ? "winner" : "",
                showReadyNow && isReady ? "ready" : ""
              ]
                .filter(Boolean)
                .join(" ");

              return (
                <div
                  key={player.sessionId}
                  className={seatClasses}
                  style={{
                    left: `${seat.left}%`,
                    top: `${seat.top}%`
                  }}
                >
                  <div className="arena-seat-head">
                    <strong>{player.nickname}</strong>
                    <span>#{player.seat}</span>
                  </div>
                  <div className="arena-seat-hand">
                    <div className="arena-seat-hand-fan" aria-label={`手牌 ${player.handCount} 张`}>
                      {Array.from({ length: visibleHandCardCount }).map((_, index) => (
                        <span key={`${player.sessionId}-hand-${index}`} className="arena-seat-hand-card" />
                      ))}
                      {hiddenHandCardCount > 0 && <span className="arena-seat-hand-more">+{hiddenHandCardCount}</span>}
                    </div>
                  </div>
                  <div className="arena-seat-meta">
                    {showReadyNow && <span>{isReady ? "已准备" : "未准备"}</span>}
                    <span>{player.connected ? "在线" : "离线"}</span>
                  </div>
                  <div className={`arena-seat-last ${isTurnSeat ? "turn" : recent ? "" : "empty"}`}>{seatLastText}</div>
                  {isTurnSeat && (
                    <div className="arena-seat-turn-tip" aria-hidden="true">
                      当前回合
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <aside className="players-sidebar">
          <h3>玩家列表</h3>
          <div className="player-side-list">
            {players.map((player) => {
              const isMe = player.sessionId === myPlayer?.sessionId;
              const isTurnSeat = player.seat === roomState?.turnSeat;
              const isDrawPulse = Boolean(drawPulseSeats[player.seat]);
              const isReady = player.ready;
              const latest = seatLatestAction[player.seat];
              const rowClass = [
                "player-side-item",
                isMe ? "me" : "",
                isDrawPulse ? "draw-pulse" : "",
                isReady ? "ready" : ""
              ]
                .filter(Boolean)
                .join(" ");

              return (
                <div key={player.sessionId} className={rowClass}>
                  <div className="player-side-head">
                    <span className="seat-index">座位 {player.seat}</span>
                    <strong>{player.nickname}</strong>
                    {showReadyBadgeInSidebar && (
                      <span className={`ready-badge ${isReady ? "on" : "off"}`}>{isReady ? "已准备" : "未准备"}</span>
                    )}
                    {isMe && <span className="seat-tag">我</span>}
                    {isTurnSeat && <span className="seat-tag turn">出牌中</span>}
                    {isDrawPulse && <span className="seat-tag drew">摸牌</span>}
                  </div>
                  <div className="player-side-meta">
                    <span>手牌 {player.handCount}</span>
                    <span>分数 {player.score}</span>
                  </div>
                  <div className="player-side-action">
                    <span>{latest ? actionText(latest) : "本轮未行动"}</span>
                    <span className="played-count">已出牌 {playedCountBySeat[player.seat] ?? 0} 张</span>
                  </div>
                </div>
              );
            })}
          </div>
        </aside>
      </section>

      <section className="panel room-hand">
        <div className="hand-shortcuts">
          <div className="hand-shortcuts-info">
            <strong>手牌快捷操作</strong>
            <span>{isMyTurn ? "当前可操作" : "等待回合"} | 已选 {selectedCards.length} 张</span>
          </div>
          <div className="hand-shortcuts-actions">
            <button type="button" disabled={passDisabled} onClick={sendPass}>
              过牌
            </button>
            <button type="button" disabled={playDisabled} onClick={sendPlay}>
              出牌
            </button>
            <button type="button" className="ghost-btn mobile-only" onClick={() => openInfoPanel("logs")}>
              信息
            </button>
          </div>
        </div>
        <HandPanel
          hand={hand}
          selected={selectedCards}
          onToggle={toggleCard}
          incomingCardId={incomingCardId}
          incomingPulseTick={incomingPulseTick}
        />
      </section>

      <section className={`panel room-info ${mobileInfoOpen ? "open" : ""}`}>
        <div className="room-info-header">
          <h3>战斗信息</h3>
          <div className="room-info-tabs">
            <button
              type="button"
              className={`room-info-tab ${mobileInfoTab === "logs" ? "active" : ""}`}
              onClick={() => setMobileInfoTab("logs")}
            >
              日志
            </button>
            <button
              type="button"
              className={`room-info-tab ${mobileInfoTab === "played" ? "active" : ""}`}
              onClick={() => setMobileInfoTab("played")}
            >
              已出牌
            </button>
          </div>
          <button type="button" className="ghost-btn room-info-close" onClick={closeInfoPanel}>
            关闭
          </button>
        </div>

        <div className={`event-layout ${mobileInfoTab === "logs" ? "tab-logs" : "tab-played"}`}>
          <div className="log-list">
            {eventLogs.map((entry) => (
              <div key={entry.id} className={`log-line ${entry.kind}`}>
                <span>{entry.text}</span>
                {entry.cards && entry.cards.length > 0 && (
                  <div className="log-cards">
                    {entry.cards.map((cardId, index) => (
                      <span key={`${entry.id}-${cardId}-${index}`} className={`log-card-mini ${cardThemeClass(cardId)}`}>
                        {toCardLabel(cardId)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          <aside className="played-visual-panel">
            <div className="played-visual-head">
              <h4>已出过的牌</h4>
              <span>{playedVisualCards.length} 张</span>
            </div>
            <div className="played-visual-grid">
              {playedVisualCards.length === 0 ? (
                <div className="played-visual-empty">本局还没有出牌记录</div>
              ) : (
                playedVisualCards.map((item) => (
                  <div key={item.id} className="played-visual-item">
                    <span className="played-visual-seat">
                      {item.seat} · {item.nickname}
                    </span>
                    <span className={`played-visual-card ${cardThemeClass(item.cardId)}`}>{toCardLabel(item.cardId)}</span>
                  </div>
                ))
              )}
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
};
