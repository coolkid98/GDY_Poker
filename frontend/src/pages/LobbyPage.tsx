import { FormEvent, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getAudioEnabledPreference, startGameBackgroundMusic, unlockGameAudio } from "../audio/game-audio";
import { getApiEndpoint, clearAuthSession, getAuthSession, loginAccount, registerAccount } from "../network/auth-client";
import { getEndpoint } from "../network/colyseus-client";
import { useGameStore } from "../store/use-game-store";

type AuthMode = "login" | "register";

export const LobbyPage = (): JSX.Element => {
  const navigate = useNavigate();
  const { setNickname } = useGameStore();

  const [mode, setMode] = useState<AuthMode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [registerNickname, setRegisterNickname] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [authVersion, setAuthVersion] = useState(0);

  const authSession = useMemo(() => {
    return getAuthSession();
  }, [authVersion]);

  const onSubmitAuth = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (submitting) {
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      const session =
        mode === "register"
          ? await registerAccount({
              username,
              password,
              nickname: registerNickname
            })
          : await loginAccount({
              username,
              password
            });

      setNickname(session.user.nickname || session.user.username);
      setAuthVersion((tick) => tick + 1);
      setPassword("");
    } catch (authError) {
      setError(String(authError instanceof Error ? authError.message : authError));
    } finally {
      setSubmitting(false);
    }
  };

  const onEnterRoom = (event: FormEvent): void => {
    event.preventDefault();
    const session = getAuthSession();
    if (!session) {
      setError("请先登录或注册");
      return;
    }

    if (getAudioEnabledPreference()) {
      void unlockGameAudio().then((ok) => {
        if (ok) {
          startGameBackgroundMusic();
        }
      });
    }

    setNickname(session.user.nickname || session.user.username);
    navigate("/room");
  };

  const onLogout = (): void => {
    clearAuthSession();
    setAuthVersion((tick) => tick + 1);
    setNickname("");
  };

  return (
    <main className="page page-lobby">
      <section className="panel">
        <h1>干瞪眼</h1>
        <p className="muted">后端 WS：{getEndpoint()}</p>
        <p className="muted">后端 API：{getApiEndpoint()}</p>

        {authSession ? (
          <form onSubmit={onEnterRoom} className="form">
            <p>
              当前账号：<strong>{authSession.user.nickname}</strong>（{authSession.user.username}）
            </p>
            <button type="submit">进入房间</button>
            <button type="button" className="ghost-btn" onClick={onLogout}>
              退出登录
            </button>
          </form>
        ) : (
          <>
            <div className="status-row">
              <button type="button" className={mode === "login" ? "" : "ghost-btn"} onClick={() => setMode("login")}>
                登录
              </button>
              <button type="button" className={mode === "register" ? "" : "ghost-btn"} onClick={() => setMode("register")}>
                注册
              </button>
            </div>
            <form onSubmit={onSubmitAuth} className="form">
              <label htmlFor="username">用户名（3-20，字母/数字/下划线）</label>
              <input
                id="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                maxLength={20}
                autoComplete="username"
              />

              <label htmlFor="password">密码（6-64）</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                maxLength={64}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
              />

              {mode === "register" ? (
                <>
                  <label htmlFor="nickname">昵称（可选）</label>
                  <input
                    id="nickname"
                    value={registerNickname}
                    onChange={(event) => setRegisterNickname(event.target.value)}
                    maxLength={20}
                    autoComplete="nickname"
                  />
                </>
              ) : null}

              <button type="submit" disabled={submitting}>
                {submitting ? "处理中..." : mode === "register" ? "注册并登录" : "登录"}
              </button>
            </form>
          </>
        )}

        {error ? <p className="hint-line">{error}</p> : null}
      </section>
    </main>
  );
};
