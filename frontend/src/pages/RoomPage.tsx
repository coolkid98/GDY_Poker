import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { HandPanel } from "../components/HandPanel";
import { joinGameRoom, leaveGameRoom } from "../network/colyseus-client";
import { normalizePlayers, useGameStore } from "../store/use-game-store";
import type { UiLastPlay } from "../types/game-state";
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
  WILDCARD_DECLARE_REQUIRED: "使用赖子时需要声明牌型和关键点数",
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

const generateActionId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
};

const toPlayersLike = (input: any): Record<string, any> => {
  if (!input) {
    return {};
  }
  if (typeof input.forEach === "function") {
    const output: Record<string, any> = {};
    input.forEach((value: any, key: string) => {
      output[key] = value;
    });
    return output;
  }
  return input as Record<string, any>;
};

const toArray = (input: any): string[] => {
  if (!input) {
    return [];
  }
  if (Array.isArray(input)) {
    return input as string[];
  }
  if (typeof input.forEach === "function") {
    const result: string[] = [];
    input.forEach((value: string) => result.push(value));
    return result;
  }
  return [];
};

export const RoomPage = (): JSX.Element => {
  const navigate = useNavigate();
  const [selectedCards, setSelectedCards] = useState<string[]>([]);
  const [declaredType, setDeclaredType] = useState("single");
  const [declaredKey, setDeclaredKey] = useState("");
  const [roomRef, setRoomRef] = useState<any>(null);

  const [tablePlayView, setTablePlayView] = useState<UiLastPlay | null>(null);
  const [tableAnimTick, setTableAnimTick] = useState(0);
  const [drawBanner, setDrawBanner] = useState<{ seat: number; tick: number } | null>(null);
  const [drawPulseSeats, setDrawPulseSeats] = useState<Record<number, number>>({});
  const [deckPulse, setDeckPulse] = useState(false);
  const [incomingCardId, setIncomingCardId] = useState<string | null>(null);
  const [incomingPulseTick, setIncomingPulseTick] = useState(0);

  const drawPulseTimersRef = useRef<Record<number, number>>({});
  const drawBannerTimerRef = useRef<number | null>(null);
  const deckPulseTimerRef = useRef<number | null>(null);
  const incomingCardTimerRef = useRef<number | null>(null);

  const { nickname, sessionId, roomState, hand, logs, setConnected, setRoomMeta, setHand, setRoomState, appendLog, clearRoom } =
    useGameStore();

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
    };
  }, []);

  useEffect(() => {
    if (!nickname) {
      navigate("/", { replace: true });
      return;
    }

    const triggerDrawEffects = (seat: number): void => {
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
        appendLog(`已进入房间 ${room.roomId}，我的 sessionId=${room.sessionId}`);

        room.onStateChange((rawState: any) => {
          const players = normalizePlayers(toPlayersLike(rawState.players)).sort((a, b) => a.seat - b.seat);
          const lastPlayCards = toArray(rawState.lastPlay?.cards);
          const hasLastPlay = Number(rawState.lastPlay?.seat ?? -1) >= 0 && lastPlayCards.length > 0;

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
            status: String(rawState.status ?? ""),
            dealerSeat: Number(rawState.dealerSeat ?? -1),
            turnSeat: Number(rawState.turnSeat ?? -1),
            deckCount: Number(rawState.deckCount ?? 0),
            passCount: Number(rawState.passCount ?? 0),
            lastPlay: nextLastPlay,
            players
          });

          setTablePlayView(nextLastPlay);
        });

        room.onMessage("hand_dealt", (message: { cards: string[] }) => {
          setHand(sortCardIds(message.cards ?? []));
          setSelectedCards([]);
          setIncomingCardId(null);
          setTablePlayView(null);
          appendLog(`收到发牌：${message.cards?.length ?? 0} 张`);
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

          appendLog(`摸牌：${toCardLabel(message.cardId)}`);
        });

        room.onMessage("hand_sync", (message: { cards: string[] }) => {
          setHand(sortCardIds(message.cards ?? []));
        });

        room.onMessage("action_result", (message: { ok: boolean; reason?: string }) => {
          if (!message.ok) {
            const readable = reasonMap[message.reason ?? ""] ?? message.reason ?? "UNKNOWN";
            appendLog(`操作失败：${readable}`);
          }
        });

        room.onMessage("played", (message: PlayedMessage) => {
          const cards = sortCardIds(message.cards ?? []);
          setTablePlayView({
            seat: message.seat,
            declaredType: message.declaredType,
            declaredKey: message.declaredKey,
            cardsCount: cards.length,
            cards
          });
          setTableAnimTick((tick) => tick + 1);

          const cardText = cards.map((card) => toCardLabel(card)).join(" ");
          appendLog(`座位 ${message.seat} 出牌 ${cards.length} 张（${message.declaredType}:${message.declaredKey}） ${cardText}`);
        });

        room.onMessage("player_drew", (message: PlayerDrewMessage) => {
          triggerDrawEffects(message.seat);

          const store = useGameStore.getState();
          const me = store.roomState?.players.find((player) => player.sessionId === store.sessionId);
          if (me?.seat !== message.seat) {
            appendLog(`座位 ${message.seat} 摸了 1 张牌`);
          }
        });

        room.onMessage("passed", (message: { seat: number }) => {
          appendLog(`座位 ${message.seat} 过牌`);
        });

        room.onMessage("round_reset", (message: { turnSeat: number }) => {
          setTablePlayView(null);
          setTableAnimTick((tick) => tick + 1);
          appendLog(`新一轮开始，座位 ${message.turnSeat} 先手`);
        });

        room.onMessage("settlement", (message: { winnerSeat: number }) => {
          appendLog(`本局结算，赢家座位 ${message.winnerSeat}`);
        });

        room.onLeave(() => {
          appendLog("已离开房间");
          setConnected(false);
        });
      })
      .catch((error: unknown) => {
        appendLog(`入房失败: ${String(error)}`);
        navigate("/", { replace: true });
      });

    return () => {
      mounted = false;
      if (joinedRoom) {
        void leaveGameRoom();
      }
    };
  }, [appendLog, navigate, nickname, setConnected, setHand, setRoomMeta, setRoomState]);

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
  const passDisabled = !isMyTurn || !hasLastPlay;
  const playDisabled = !isMyTurn || selectedCards.length === 0 || (selectedHasWildcard && (!declaredType || !declaredKey));

  const tablePlay = tablePlayView ?? roomState?.lastPlay ?? null;

  const toggleCard = (cardId: string): void => {
    setSelectedCards((prev) => {
      const next = prev.includes(cardId) ? prev.filter((id) => id !== cardId) : [...prev, cardId];
      return sortCardIds(next);
    });
  };

  const sendReady = (ready: boolean): void => {
    roomRef?.send("ready", { ready });
  };

  const sendPass = (): void => {
    if (passDisabled) {
      return;
    }
    roomRef?.send("pass", {
      actionId: generateActionId(),
      seq: Date.now()
    });
  };

  const sendPlay = (): void => {
    if (playDisabled) {
      return;
    }
    const payload: Record<string, any> = {
      actionId: generateActionId(),
      seq: Date.now(),
      cards: selectedCards
    };
    if (selectedHasWildcard || (declaredType && declaredKey)) {
      payload.declaredType = declaredType;
      payload.declaredKey = declaredKey.toUpperCase();
    }
    roomRef?.send("play_cards", payload);
    setSelectedCards([]);
  };

  const leaveRoom = async (): Promise<void> => {
    await leaveGameRoom();
    clearRoom();
    navigate("/", { replace: true });
  };

  return (
    <main className="page page-room">
      <section className="panel hero-panel">
        <div className="toolbar">
          <h2>房间：{roomState?.roomId ?? "-"}</h2>
          <button type="button" className="ghost-btn" onClick={leaveRoom}>
            退出房间
          </button>
        </div>
        <div className="status-row">
          <span className="status-pill">状态 {roomState?.status ?? "-"}</span>
          <span className={`status-pill ${deckPulse ? "deck-pulse" : ""}`}>牌堆 {roomState?.deckCount ?? 0}</span>
          <span className="status-pill">当前回合座位 {roomState?.turnSeat ?? "-"}</span>
          <span className="status-pill">我的座位 {myPlayer?.seat ?? "-"}</span>
        </div>

        <div className="action-wrap">
          <button type="button" disabled={readyDisabled} onClick={() => sendReady(true)}>
            准备
          </button>
          <button type="button" disabled={readyDisabled} onClick={() => sendReady(false)}>
            取消准备
          </button>
          <button type="button" disabled={passDisabled} onClick={sendPass}>
            过牌
          </button>
          <button type="button" disabled={playDisabled} onClick={sendPlay}>
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
              牌型声明
              <select value={declaredType} onChange={(e) => setDeclaredType(e.target.value)}>
                {patternOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              关键点数
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

        <div className="table-stage">
          <div className="table-stage-head">
            <h4>桌面出牌区</h4>
            {drawBanner && (
              <span key={`draw-${drawBanner.tick}`} className="draw-banner">
                座位 {drawBanner.seat} 摸了 1 张牌
              </span>
            )}
          </div>
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
      </section>

      <section className="panel">
        <h3>玩家列表</h3>
        <table className="players-table">
          <thead>
            <tr>
              <th>座位</th>
              <th>昵称</th>
              <th>手牌</th>
              <th>状态</th>
              <th>分数</th>
            </tr>
          </thead>
          <tbody>
            {(roomState?.players ?? []).map((player) => {
              const isMe = player.sessionId === myPlayer?.sessionId;
              const isTurnSeat = player.seat === roomState?.turnSeat;
              const isDrawPulse = Boolean(drawPulseSeats[player.seat]);
              const rowClass = [isMe ? "me" : "", isDrawPulse ? "draw-pulse" : ""].filter(Boolean).join(" ");

              return (
                <tr key={player.sessionId} className={rowClass}>
                  <td>{player.seat}</td>
                  <td>
                    {player.nickname}
                    {isMe && <span className="seat-tag">我</span>}
                    {isTurnSeat && <span className="seat-tag turn">出牌中</span>}
                    {isDrawPulse && <span className="seat-tag drew">摸牌</span>}
                  </td>
                  <td>{player.handCount}</td>
                  <td>
                    {player.ready ? "ready" : "idle"} / {player.connected ? "online" : "offline"}
                  </td>
                  <td>{player.score}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <HandPanel
          hand={hand}
          selected={selectedCards}
          onToggle={toggleCard}
          incomingCardId={incomingCardId}
          incomingPulseTick={incomingPulseTick}
        />
      </section>

      <section className="panel">
        <h3>事件日志</h3>
        <div className="log-list">
          {logs.map((line, index) => (
            <div key={`${index}-${line}`} className="log-line">
              {line}
            </div>
          ))}
        </div>
      </section>
    </main>
  );
};
