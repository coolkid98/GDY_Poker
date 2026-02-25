import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGameStore } from "../store/use-game-store";
import { getEndpoint } from "../network/colyseus-client";

export const LobbyPage = (): JSX.Element => {
  const navigate = useNavigate();
  const { nickname: persistedNickname, setNickname } = useGameStore();
  const [nickname, setLocalNickname] = useState(persistedNickname || `玩家${Math.floor(Math.random() * 9000 + 1000)}`);

  const onEnterRoom = (event: FormEvent): void => {
    event.preventDefault();
    const finalNickname = nickname.trim();
    if (!finalNickname) {
      return;
    }
    setNickname(finalNickname);
    navigate("/room");
  };

  return (
    <main className="page page-lobby">
      <section className="panel">
        <h1>干瞪眼 Web</h1>
        <p className="muted">当前后端地址：{getEndpoint()}</p>
        <form onSubmit={onEnterRoom} className="form">
          <label htmlFor="nickname">昵称</label>
          <input
            id="nickname"
            value={nickname}
            onChange={(event) => setLocalNickname(event.target.value)}
            maxLength={20}
            autoComplete="off"
          />
          <button type="submit">进入房间</button>
        </form>
      </section>
    </main>
  );
};
