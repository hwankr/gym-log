import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { useOnline } from "../lib/online";

interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const PwaContext = createContext({
  canInstall: false,
  ios: false,
  installing: false,
  install: async () => {},
  setUpdateBlocked: (_blocked: boolean) => {},
});

export const usePwa = () => useContext(PwaContext);

export function PwaProvider({ children }: { children: ReactNode }) {
  const online = useOnline();
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [installed, setInstalled] = useState(
    () =>
      matchMedia("(display-mode: standalone)").matches ||
      Boolean((navigator as Navigator & { standalone?: boolean }).standalone),
  );
  const [installing, setInstalling] = useState(false);
  const [updateBlocked, setUpdateBlocked] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState("");
  const [registration, setRegistration] = useState<ServiceWorkerRegistration>();
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, value) {
      setRegistration(value);
    },
    onRegisterError() {
      setError(
        "앱의 오프라인 준비에 실패했어요. 연결을 확인하고 앱을 다시 열어 주세요.",
      );
    },
  });

  useEffect(() => {
    const beforeInstall = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallPrompt);
    };
    const appInstalled = () => {
      setInstalled(true);
      setPrompt(null);
    };
    const displayMode = matchMedia("(display-mode: standalone)");
    const displayChanged = () => setInstalled(displayMode.matches);
    window.addEventListener("beforeinstallprompt", beforeInstall);
    window.addEventListener("appinstalled", appInstalled);
    displayMode.addEventListener("change", displayChanged);
    return () => {
      window.removeEventListener("beforeinstallprompt", beforeInstall);
      window.removeEventListener("appinstalled", appInstalled);
      displayMode.removeEventListener("change", displayChanged);
    };
  }, []);

  useEffect(() => {
    if (!registration) return;
    const check = () => {
      if (navigator.onLine && document.visibilityState === "visible") {
        void registration.update().catch(() => {
          /* Retry on the next foreground check. */
        });
      }
    };
    window.addEventListener("online", check);
    document.addEventListener("visibilitychange", check);
    const interval = window.setInterval(check, 60 * 60 * 1000);
    return () => {
      window.removeEventListener("online", check);
      document.removeEventListener("visibilitychange", check);
      window.clearInterval(interval);
    };
  }, [registration]);

  const ios =
    !installed &&
    (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

  const install = async () => {
    if (!prompt || installing) return;
    setInstalling(true);
    try {
      await prompt.prompt();
      await prompt.userChoice;
    } catch {
      setError(
        "설치를 시작하지 못했어요. 브라우저 메뉴에서 앱 설치를 선택해 주세요.",
      );
    } finally {
      setPrompt(null);
      setInstalling(false);
    }
  };

  const update = async () => {
    if (updateBlocked || !online || updating) return;
    if (
      !window.confirm(
        "새 버전을 적용하면 앱이 새로고침돼요. 다른 창을 포함해 작성 중인 기록을 모두 저장했나요?",
      )
    )
      return;
    setUpdating(true);
    try {
      await updateServiceWorker(true);
    } catch {
      setError("업데이트하지 못했어요. 연결을 확인하고 다시 시도해 주세요.");
    } finally {
      setUpdating(false);
    }
  };

  return (
    <PwaContext
      value={{
        canInstall: !installed && Boolean(prompt),
        ios,
        installing,
        install,
        setUpdateBlocked,
      }}
    >
      {children}
      {(!online || needRefresh || error) && (
        <aside className="pwa-notice" aria-label="앱 상태">
          {!online && (
            <p role="status">
              오프라인이에요. 저장하려면 인터넷 연결이 필요해요. 작성 중인
              화면을 닫지 마세요.
            </p>
          )}
          {needRefresh && (
            <>
              <p role="status">
                새 버전이 준비됐어요.
                {updateBlocked
                  ? " 작성과 저장을 마친 뒤 업데이트해 주세요."
                  : " 저장을 마친 뒤 업데이트해 주세요."}
              </p>
              <div className="pwa-actions">
                <button
                  type="button"
                  className="button button-primary"
                  disabled={!online || updateBlocked || updating}
                  onClick={() => void update()}
                >
                  {updating ? "업데이트 중…" : "업데이트"}
                </button>
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => setNeedRefresh(false)}
                >
                  나중에
                </button>
              </div>
            </>
          )}
          {error && (
            <div role="alert">
              <p>{error}</p>
              <button
                type="button"
                className="text-button"
                onClick={() => setError("")}
              >
                닫기
              </button>
            </div>
          )}
        </aside>
      )}
    </PwaContext>
  );
}

export function PwaInstall() {
  const { canInstall, ios, installing, install } = usePwa();
  if (!canInstall && !ios) return null;
  return (
    <div className="pwa-install">
      {canInstall ? (
        <button
          type="button"
          className="button button-secondary"
          disabled={installing}
          onClick={() => void install()}
        >
          {installing ? "설치 창 여는 중…" : "Gym Log 앱 설치"}
        </button>
      ) : (
        <p>
          홈 화면에서 바로 시작하세요.
          <br />
          브라우저의 공유 메뉴 → 홈 화면에 추가를 선택해 주세요.
        </p>
      )}
    </div>
  );
}
