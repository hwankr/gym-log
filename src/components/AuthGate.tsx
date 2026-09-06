import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { authClient } from "../lib/auth-client";
import Icon from "./Icon";
import "../auth.css";

type AuthSession = {
  user: { id: string; name: string; email: string };
  signOut: () => Promise<void>;
};

function authErrorMessage(error: unknown) {
  if (typeof error !== "object" || !error) {
    return "서버에 연결하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.";
  }
  const details = error as { code?: string; status?: number };
  if (
    details.code === "USER_ALREADY_EXISTS" ||
    details.code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL"
  ) {
    return "이미 가입된 이메일이에요. 로그인해 주세요.";
  }
  if (details.code === "INVALID_EMAIL_OR_PASSWORD" || details.status === 401) {
    return "이메일 또는 비밀번호를 확인해 주세요.";
  }
  if (details.code === "PASSWORD_TOO_SHORT")
    return "비밀번호는 8자 이상으로 입력해 주세요.";
  if (details.code === "PASSWORD_TOO_LONG")
    return "비밀번호는 128자 이하로 입력해 주세요.";
  if (details.code === "INVALID_EMAIL")
    return "올바른 이메일 주소를 입력해 주세요.";
  if (details.status === 429)
    return "요청이 너무 많아요. 잠시 후 다시 시도해 주세요.";
  if (details.status === 403)
    return "로그인을 진행할 수 없어요. 계정 상태를 확인해 주세요.";
  return "로그인 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.";
}

export default function AuthGate({
  children,
}: {
  children: (session: AuthSession) => ReactNode;
}) {
  const {
    data,
    isPending,
    error: sessionError,
    refetch,
  } = authClient.useSession();
  const [isSignUp, setIsSignUp] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [invalidated, setInvalidated] = useState(false);

  useEffect(() => {
    const handleExpired = () => {
      setInvalidated(true);
      setError("로그인이 만료되었어요. 다시 로그인해 주세요.");
      void refetch({ query: { disableCookieCache: true } });
    };
    window.addEventListener("gym-log:auth-expired", handleExpired);
    return () =>
      window.removeEventListener("gym-log:auth-expired", handleExpired);
  }, [refetch]);

  const signOut = async () => {
    try {
      const result = await authClient.signOut();
      if (result.error) throw result.error;
      setPassword("");
      setError("");
      setInvalidated(false);
      await refetch();
    } catch (cause) {
      throw new Error(authErrorMessage(cause));
    }
  };

  if (!invalidated && data?.session && data.user) {
    return children({
      user: { id: data.user.id, name: data.user.name, email: data.user.email },
      signOut,
    });
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    if (isSignUp && !name.trim()) {
      setError("이름을 입력해 주세요.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = isSignUp
        ? await authClient.signUp.email({
            name: name.trim(),
            email: email.trim(),
            password,
          })
        : await authClient.signIn.email({ email: email.trim(), password });
      if (result.error) throw result.error;
      const session = await authClient.getSession();
      if (session.error) throw session.error;
      if (!session.data?.session || !session.data.user) {
        setError(
          "로그인 상태를 저장하지 못했어요. 브라우저의 쿠키 설정을 확인해 주세요.",
        );
        return;
      }
      setPassword("");
      setInvalidated(false);
      await refetch();
    } catch (cause) {
      setError(authErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="auth-heading">
        <div className="auth-brand">
          <span className="brand-mark">
            <Icon name="dumbbell" size={23} />
          </span>
          <span>
            gym<span className="brand-light">log</span>
            <span className="brand-dot">.</span>
          </span>
        </div>
        <span className="auth-eyebrow">YOUR WORKOUT, EVERYWHERE</span>
        <h1 id="auth-heading">
          {isSignUp ? "나만의 운동 기록을 시작해요" : "오늘의 운동도, 차곡차곡"}
        </h1>
        <p className="auth-description">
          로그인하면 운동 기록과 루틴을 휴대폰과 PC에서 이어서 사용할 수 있어요.
        </p>

        {isPending ? (
          <p className="auth-loading" role="status">
            로그인 상태를 확인하고 있어요…
          </p>
        ) : (
          <>
            <form className="auth-form" onSubmit={submit} aria-busy={busy}>
              {isSignUp && (
                <label className="auth-field" htmlFor="auth-name">
                  <span>이름</span>
                  <input
                    id="auth-name"
                    className="input"
                    name="name"
                    autoComplete="name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    required
                    maxLength={80}
                    disabled={busy}
                    placeholder="사용할 이름"
                  />
                </label>
              )}
              <label className="auth-field" htmlFor="auth-email">
                <span>이메일</span>
                <input
                  id="auth-email"
                  className="input"
                  name="email"
                  type="email"
                  inputMode="email"
                  autoCapitalize="none"
                  autoCorrect="off"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  maxLength={254}
                  disabled={busy}
                  placeholder="you@example.com"
                />
              </label>
              <label className="auth-field" htmlFor="auth-password">
                <span>비밀번호</span>
                <input
                  id="auth-password"
                  className="input"
                  name="password"
                  type="password"
                  autoComplete={isSignUp ? "new-password" : "current-password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  minLength={8}
                  maxLength={128}
                  disabled={busy}
                  placeholder="8자 이상 입력해 주세요"
                />
              </label>
              {(error || sessionError) && (
                <p className="auth-error" role="alert">
                  {error || authErrorMessage(sessionError)}
                </p>
              )}
              <button
                className="button button-primary auth-submit"
                type="submit"
                disabled={busy}
              >
                {busy
                  ? "잠시만 기다려 주세요…"
                  : isSignUp
                    ? "회원가입"
                    : "로그인"}
                {!busy && <Icon name="arrow" size={18} />}
              </button>
            </form>
            {sessionError && (
              <button
                className="auth-retry"
                type="button"
                disabled={busy}
                onClick={() => {
                  setError("");
                  void refetch();
                }}
              >
                연결 다시 확인
              </button>
            )}
            <div className="auth-toggle">
              <span>
                {isSignUp ? "이미 계정이 있으신가요?" : "처음 오셨나요?"}
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setIsSignUp(!isSignUp);
                  setError("");
                  setPassword("");
                }}
              >
                {isSignUp ? "로그인" : "회원가입"}
              </button>
            </div>
          </>
        )}
        <p className="auth-note">
          <Icon name="leaf" size={16} /> 어제보다 한 걸음 더.
        </p>
      </section>
    </main>
  );
}
