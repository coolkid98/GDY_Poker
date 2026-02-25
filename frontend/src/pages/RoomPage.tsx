import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { HandPanel } from "../components/HandPanel";
import { joinGameRoom, leaveGameRoom } from "../network/colyseus-client";
import { normalizePlayers, useGameStore } from "../store/use-game-store";

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

export const RoomPage = (): JSX.Element => {
  const navigate = useNavigate();
  const [selectedCards, setSelectedCards] = useState<string[]>([]);
  const [declaredType, setDeclaredType] = useState("");
  const [declaredKey, setDeclaredKey] = useState("");
  const [roomRef, setRoomRef] = useState<any>(null);

  const {
    nickname,
    sessionId,
    roomState,
    hand,
    logs,
    setConnected,
    setRoomMeta,
    setHand,
    addHandCard,
    setRoomState,
    appendLog,
    clearRoom
  } = useGameStore();

  useEffect(() => {
    if (!nickname) {
      navigate("/", { replace: true });
      return;
    }

    let mounted = true;
    joinGameRoom(nickname)
      .then((room) => {
        if (!mounted) {
          return;
        }

        setRoomRef(room);
        setConnected(true);
        setRoomMeta(room.roomId, room.sessionId);
        appendLog(`已进入房间 ${room.roomId}，我的 sessionId=${room.sessionId}`);

        room.onStateChange((rawState: any) => {
          const players = normalizePlayers(toPlayersLike(rawState.players)).sort((a, b) => a.seat - b.seat);
          setRoomState({
            roomId: String(rawState.roomId ?? room.roomId),
            status: String(rawState.status ?? ""),
            dealerSeat: Number(rawState.dealerSeat ?? -1),
            turnSeat: Number(rawState.turnSeat ?? -1),
            deckCount: Number(rawState.deckCount ?? 0),
            passCount: Number(rawState.passCount ?? 0),
            players
          });
        });

        room.onMessage("hand_dealt", (message: { cards: string[] }) => {
          setHand(message.cards ?? []);
          setSelectedCards([]);
          appendLog(`收到发牌：${message.cards?.length ?? 0} 张`);
        });

        room.onMessage("draw_card", (message: { cardId: string }) => {
          addHandCard(message.cardId);
          appendLog(`摸牌：${message.cardId}`);
        });

        room.onMessage("hand_sync", (message: { cards: string[] }) => {
          setHand(message.cards ?? []);
        });

        room.onMessage("action_result", (message: { ok: boolean; reason?: string }) => {
          if (!message.ok) {
            appendLog(`操作失败：${message.reason ?? "UNKNOWN"}`);
          }
        });

        room.onMessage("played", (message: { seat: number; cardsCount: number }) => {
          appendLog(`座位 ${message.seat} 出牌 ${message.cardsCount} 张`);
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
    };
  }, [addHandCard, appendLog, navigate, nickname, setConnected, setHand, setRoomMeta, setRoomState]);

  const myPlayer = useMemo(() => {
    if (!roomState) {
      return null;
    }
    return roomState.players.find((p) => p.sessionId === sessionId) ?? null;
  }, [roomState, sessionId]);

  const toggleCard = (cardId: string): void => {
    setSelectedCards((prev) => (prev.includes(cardId) ? prev.filter((id) => id !== cardId) : [...prev, cardId]));
  };

  const sendReady = (): void => {
    roomRef?.send("ready", { ready: true });
  };

  const sendPass = (): void => {
    roomRef?.send("pass", {
      actionId: generateActionId(),
      seq: Date.now()
    });
  };

  const sendPlay = (): void => {
    if (selectedCards.length === 0) {
      return;
    }
    roomRef?.send("play_cards", {
      actionId: generateActionId(),
      seq: Date.now(),
      cards: selectedCards,
      declaredType: declaredType || undefined,
      declaredKey: declaredKey || undefined
    });
    setSelectedCards([]);
  };

  const leaveRoom = async (): Promise<void> => {
    await leaveGameRoom();
    clearRoom();
    navigate("/", { replace: true });
  };

  return (
    <main className="page page-room">
      <section className="panel">
        <div className="toolbar">
          <h2>房间：{roomState?.roomId ?? "-"}</h2>
          <button type="button" onClick={leaveRoom}>
            退出房间
          </button>
        </div>
        <p className="muted">
          状态：{roomState?.status ?? "-"} | 牌堆：{roomState?.deckCount ?? 0} | 当前回合座位：{roomState?.turnSeat ?? "-"}
        </p>
        <div className="button-row">
          <button type="button" onClick={sendReady}>
            准备
          </button>
          <button type="button" onClick={sendPass}>
            过牌
          </button>
          <button type="button" onClick={sendPlay}>
            出牌
          </button>
        </div>
        <div className="field-row">
          <label>
            declaredType
            <input value={declaredType} onChange={(e) => setDeclaredType(e.target.value)} placeholder="single/pair/straight/bomb" />
          </label>
          <label>
            declaredKey
            <input value={declaredKey} onChange={(e) => setDeclaredKey(e.target.value)} placeholder="可选，后端将用于赖子定型" />
          </label>
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
            {(roomState?.players ?? []).map((player) => (
              <tr key={player.sessionId} className={player.seat === myPlayer?.seat ? "me" : ""}>
                <td>{player.seat}</td>
                <td>{player.nickname}</td>
                <td>{player.handCount}</td>
                <td>{player.ready ? "ready" : "idle"} / {player.connected ? "online" : "offline"}</td>
                <td>{player.score}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <HandPanel hand={hand} selected={selectedCards} onToggle={toggleCard} />
      </section>

      <section className="panel">
        <h3>事件日志</h3>
        <div className="log-list">
          {logs.map((line, idx) => (
            <div key={`${idx}-${line}`} className="log-line">
              {line}
            </div>
          ))}
        </div>
      </section>
    </main>
  );
};
