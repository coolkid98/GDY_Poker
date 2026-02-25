import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { HandPanel } from "../components/HandPanel";
import { joinGameRoom, leaveGameRoom } from "../network/colyseus-client";
import { normalizePlayers, useGameStore } from "../store/use-game-store";
import { hasWildcard, sortCardIds } from "../utils/cards";

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
  DUPLICATE_ACTION: "重复操作已忽略"
};

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

  const { nickname, sessionId, roomState, hand, logs, setConnected, setRoomMeta, setHand, setRoomState, appendLog, clearRoom } =
    useGameStore();

  useEffect(() => {
    if (!nickname) {
      navigate("/", { replace: true });
      return;
    }

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

          setRoomState({
            roomId: String(rawState.roomId ?? room.roomId),
            status: String(rawState.status ?? ""),
            dealerSeat: Number(rawState.dealerSeat ?? -1),
            turnSeat: Number(rawState.turnSeat ?? -1),
            deckCount: Number(rawState.deckCount ?? 0),
            passCount: Number(rawState.passCount ?? 0),
            lastPlay: hasLastPlay
              ? {
                  seat: Number(rawState.lastPlay?.seat ?? -1),
                  declaredType: String(rawState.lastPlay?.declaredType ?? ""),
                  declaredKey: String(rawState.lastPlay?.declaredKey ?? ""),
                  cardsCount: lastPlayCards.length
                }
              : null,
            players
          });
        });

        room.onMessage("hand_dealt", (message: { cards: string[] }) => {
          setHand(sortCardIds(message.cards ?? []));
          setSelectedCards([]);
          appendLog(`收到发牌：${message.cards?.length ?? 0} 张`);
        });

        room.onMessage("draw_card", (message: { cardId: string }) => {
          const current = useGameStore.getState().hand;
          setHand(sortCardIds([...current, message.cardId]));
          appendLog(`摸牌：${message.cardId}`);
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

        room.onMessage("played", (message: { seat: number; cardsCount: number; declaredType: string; declaredKey: string }) => {
          appendLog(`座位 ${message.seat} 出牌 ${message.cardsCount} 张（${message.declaredType}:${message.declaredKey}）`);
        });

        room.onMessage("passed", (message: { seat: number }) => {
          appendLog(`座位 ${message.seat} 过牌`);
        });

        room.onMessage("round_reset", (message: { turnSeat: number }) => {
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
          <span className="status-pill">牌堆 {roomState?.deckCount ?? 0}</span>
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

        <div className="last-play-box">
          <h4>上一手</h4>
          {!roomState?.lastPlay ? (
            <p className="muted">当前无可跟牌型</p>
          ) : (
            <p className="muted">
              座位 {roomState.lastPlay.seat} | {roomState.lastPlay.cardsCount} 张 | {roomState.lastPlay.declaredType}:
              {roomState.lastPlay.declaredKey}
            </p>
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
              return (
                <tr key={player.sessionId} className={isMe ? "me" : ""}>
                  <td>{player.seat}</td>
                  <td>
                    {player.nickname}
                    {isMe && <span className="seat-tag">我</span>}
                    {isTurnSeat && <span className="seat-tag turn">出牌中</span>}
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
        <HandPanel hand={hand} selected={selectedCards} onToggle={toggleCard} />
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
