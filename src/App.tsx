import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import Icon, { type IconName } from "./components/Icon";
import Modal from "./components/Modal";
import WorkoutEditor from "./components/WorkoutEditor";
import AuthGate from "./components/AuthGate";
import { CloudError, getCloudData, saveCloudData } from "./lib/cloud";
import { legacyStorageStatus, mergeLegacyData } from "./lib/legacy";
import {
  MUSCLE_GROUPS,
  cloneExercises,
  countSets,
  getGroups,
  localDate,
  parseBackup,
  uid,
  workoutVolume,
  type GymData,
  type MuscleGroup,
  type Routine,
  type Workout,
} from "./lib/gym";

type Page = "dashboard" | "records" | "routines";
type DialogState =
  | { kind: "workout"; initial?: Workout }
  | { kind: "routine"; initial?: Routine }
  | { kind: "detail"; workout: Workout }
  | { kind: "settings" }
  | null;
const navigation: { id: Page; name: string; icon: IconName }[] = [
  { id: "dashboard", name: "대시보드", icon: "dashboard" },
  { id: "records", name: "운동 기록", icon: "calendar" },
  { id: "routines", name: "나의 루틴", icon: "layers" },
];
const number = (value: number) =>
  value.toLocaleString("ko-KR", { maximumFractionDigits: 1 });
const dateObject = (value: string) => new Date(`${value}T12:00:00`);
const displayDate = (value: string, options?: Intl.DateTimeFormatOptions) =>
  dateObject(value).toLocaleDateString(
    "ko-KR",
    options ?? { month: "long", day: "numeric", weekday: "short" },
  );
const currentPage = (): Page =>
  navigation.some((item) => item.id === location.hash.slice(1))
    ? (location.hash.slice(1) as Page)
    : "dashboard";
function weekDates(offset: number, today: string) {
  const start = dateObject(today);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7) + offset * 7);
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return localDate(day);
  });
}
function GroupTags({ groups }: { groups: MuscleGroup[] }) {
  return (
    <div className="group-tags">
      {groups.map((group) => (
        <span key={group} className={`group-tag group-${group}`}>
          {group}
        </span>
      ))}
    </div>
  );
}

function RecordCard({
  workout,
  onOpen,
}: {
  workout: Workout;
  onOpen: (workout: Workout) => void;
}) {
  return (
    <button className="record-card" onClick={() => onOpen(workout)}>
      <span className="record-date">
        <strong>
          {dateObject(workout.date).getDate().toString().padStart(2, "0")}
        </strong>
        <span>
          {dateObject(workout.date).getMonth() + 1}월 ·{" "}
          {dateObject(workout.date).toLocaleDateString("ko-KR", {
            weekday: "short",
          })}
        </span>
      </span>
      <span className="record-info">
        <span className="record-title">{workout.name}</span>
        <span className="record-exercises">
          {workout.exercises.map((item) => item.name).join(" · ")}
        </span>
        <span className="record-meta">
          {workout.exercises.length}개 운동<span>·</span>
          {countSets(workout.exercises)}세트<span>·</span>
          {number(workoutVolume(workout.exercises))} kg
        </span>
      </span>
      <span className="record-end">
        <GroupTags groups={getGroups(workout.exercises)} />
        <Icon name="chevronRight" size={18} />
      </span>
    </button>
  );
}

export default function App() {
  return (
    <AuthGate>
      {({ user, signOut }) => (
        <GymApp key={user.id} user={user} signOut={signOut} />
      )}
    </AuthGate>
  );
}

function GymApp({
  user,
  signOut,
}: {
  user: { id: string; name: string; email: string };
  signOut: () => Promise<void>;
}) {
  const [data, setData] = useState<GymData>({
    version: 1,
    workouts: [],
    routines: [],
  });
  const [revision, setRevision] = useState<number | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncedAt, setSyncedAt] = useState<Date | null>(null);
  const [legacy, setLegacy] = useState(() => legacyStorageStatus(user.id));
  const savingRef = useRef(false);
  const requestGeneration = useRef(0);
  const [page, setPage] = useState<Page>(currentPage);
  const [dialog, setDialogState] = useState<DialogState>(null);
  const [conflict, setConflict] = useState(false);
  const [toast, setToast] = useState("");
  const [groupFilter, setGroupFilter] = useState<MuscleGroup | "전체">("전체");
  const [search, setSearch] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [monthFilter, setMonthFilter] = useState("");
  const [weekOffset, setWeekOffset] = useState(0);
  const [today, setToday] = useState(localDate);
  const importRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const sync = () => setPage(currentPage());
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  useEffect(() => {
    const id = window.setInterval(() => setToday(localDate()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(""), 4000);
    return () => window.clearTimeout(id);
  }, [toast]);
  const refreshCloud = useCallback(async () => {
    const generation = ++requestGeneration.current;
    try {
      const snapshot = await getCloudData();
      if (generation !== requestGeneration.current) return false;
      setData(snapshot.data);
      setRevision(snapshot.revision);
      setStorageError(null);
      setSyncedAt(new Date());
      return true;
    } catch (error) {
      if (generation === requestGeneration.current)
        setStorageError(
          error instanceof Error ? error.message : "기록을 불러오지 못했어요.",
        );
      return false;
    } finally {
      if (generation === requestGeneration.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refreshCloud();
    return () => {
      requestGeneration.current += 1;
    };
  }, [refreshCloud]);
  useEffect(() => {
    const refresh = () => {
      if (
        !dialog &&
        !savingRef.current &&
        document.visibilityState === "visible"
      )
        void refreshCloud();
    };
    const interval = window.setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
    };
  }, [dialog, refreshCloud]);

  function setDialog(next: DialogState) {
    if (next) requestGeneration.current += 1;
    setConflict(false);
    setDialogState(next);
  }

  function navigate(next: Page) {
    location.hash = next;
    setPage(next);
    setSearch("");
    setGroupFilter("전체");
    setDateFilter("");
    setMonthFilter("");
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  async function commit(next: GymData) {
    if (savingRef.current || revision === null) return false;
    if (
      conflict &&
      !window.confirm(
        "다른 기기에서 변경한 내용이 있어요. 확인한 최신 기록에 현재 작성 내용을 저장할까요?",
      )
    )
      return false;
    savingRef.current = true;
    setSaving(true);
    const generation = ++requestGeneration.current;
    try {
      const snapshot = await saveCloudData(next, revision);
      if (generation !== requestGeneration.current) return false;
      setData(snapshot.data);
      setRevision(snapshot.revision);
      setStorageError(null);
      setSyncedAt(new Date());
      setConflict(false);
      return true;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "저장하지 못했어요. 다시 시도해주세요.";
      setToast(message);
      setStorageError(message);
      if (error instanceof CloudError && error.status === 409) {
        await refreshCloud();
        if (dialog?.kind === "workout" || dialog?.kind === "routine")
          setConflict(true);
      }
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }
  async function handleSignOut() {
    if (savingRef.current) return;
    try {
      await signOut();
    } catch (error) {
      setToast(
        error instanceof Error ? error.message : "로그아웃하지 못했어요.",
      );
    }
  }
  async function importLegacy() {
    if (!legacy.data || savingRef.current) return;
    if (
      !window.confirm(
        `이 브라우저의 운동 기록 ${legacy.data.workouts.length}개와 루틴 ${legacy.data.routines.length}개를 ${user.email} 계정으로 가져올까요? 기존 서버 기록은 유지됩니다.`,
      )
    )
      return;
    if (await commit(mergeLegacyData(data, legacy.data))) {
      try {
        if (legacy.raw)
          localStorage.setItem(`gym-log:imported:${user.id}`, legacy.raw);
      } catch {
        /* Cloud import succeeded; local data remains untouched. */
      }
      setLegacy({ data: null, error: null, raw: null });
      setToast("이전 브라우저 기록을 계정으로 가져왔어요.");
    }
  }
  function downloadJson(content: string, filename: string) {
    const url = URL.createObjectURL(
      new Blob([content], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function saveWorkout(value: Workout | Routine) {
    const workout = value as Workout;
    const exists = data.workouts.some((item) => item.id === workout.id);
    if (
      await commit({
        ...data,
        workouts: exists
          ? data.workouts.map((item) =>
              item.id === workout.id ? workout : item,
            )
          : [...data.workouts, workout],
      })
    ) {
      setDialog(null);
      setToast(
        exists
          ? "운동 기록을 수정했어요."
          : "오늘의 노력을 기록했어요. 수고하셨습니다!",
      );
    }
  }
  async function saveRoutine(value: Workout | Routine) {
    const routine = value as Routine;
    const exists = data.routines.some((item) => item.id === routine.id);
    if (
      await commit({
        ...data,
        routines: exists
          ? data.routines.map((item) =>
              item.id === routine.id ? routine : item,
            )
          : [...data.routines, routine],
      })
    ) {
      setDialog(null);
      setToast(exists ? "루틴을 수정했어요." : "나만의 루틴을 저장했어요.");
    }
  }
  function startRoutine(routine: Routine) {
    setDialog({
      kind: "workout",
      initial: {
        id: uid(),
        name: routine.name,
        date: today,
        duration: 0,
        notes: "",
        exercises: cloneExercises(routine.exercises),
        createdAt: new Date().toISOString(),
      },
    });
  }
  async function deleteWorkout(workout: Workout) {
    if (
      !window.confirm(
        `'${workout.name}' 기록을 삭제할까요? 삭제한 기록은 복구할 수 없어요.`,
      )
    )
      return;
    if (
      await commit({
        ...data,
        workouts: data.workouts.filter((item) => item.id !== workout.id),
      })
    ) {
      setDialog(null);
      setToast("운동 기록을 삭제했어요.");
    }
  }
  async function deleteRoutine(routine: Routine) {
    if (
      !window.confirm(
        `'${routine.name}' 루틴을 삭제할까요? 기존 운동 기록은 유지돼요.`,
      )
    )
      return;
    if (
      await commit({
        ...data,
        routines: data.routines.filter((item) => item.id !== routine.id),
      })
    )
      setToast("루틴을 삭제했어요.");
  }
  function exportBackup() {
    downloadJson(JSON.stringify(data, null, 2), `gym-log-${today}.json`);
    setToast("현재 서버 기록을 백업했어요.");
  }
  async function importBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setToast("10MB 이하의 백업 파일을 선택해주세요.");
      return;
    }
    try {
      const restored = parseBackup(await file.text());
      if (
        !window.confirm(
          `운동 기록 ${restored.workouts.length}개와 루틴 ${restored.routines.length}개를 가져올까요? 현재 계정의 서버 기록이 이 백업으로 교체되며 다른 기기에도 반영됩니다.`,
        )
      )
        return;
      if (!(await commit(restored))) return;
      setDialog(null);
      setToast("백업 데이터를 가져왔어요.");
    } catch (error) {
      setToast(
        error instanceof Error ? error.message : "백업 파일을 읽을 수 없어요.",
      );
    }
  }
  const weeks = weekDates(weekOffset, today);
  const thisWeek = weekDates(0, today);
  const weekWorkouts = data.workouts.filter(
    (item) => item.date >= thisWeek[0] && item.date <= today,
  );
  const workoutDays = new Set(data.workouts.map((item) => item.date));
  const activeWeekDays = new Set(weekWorkouts.map((item) => item.date)).size;
  const sortedWorkouts = [...data.workouts].sort(
    (a, b) =>
      b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt),
  );
  const visibleWorkouts = sortedWorkouts.filter(
    (item) =>
      (groupFilter === "전체" ||
        getGroups(item.exercises).includes(groupFilter)) &&
      (!dateFilter || item.date === dateFilter) &&
      (!monthFilter || item.date.startsWith(monthFilter)) &&
      (
        item.name +
        item.notes +
        item.exercises.map((exercise) => exercise.name).join(" ")
      )
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const visibleRoutines = data.routines.filter(
    (item) =>
      (groupFilter === "전체" ||
        getGroups(item.exercises).includes(groupFilter)) &&
      (
        item.name +
        item.description +
        item.exercises.map((exercise) => exercise.name).join(" ")
      )
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const isExistingWorkout =
    dialog?.kind === "workout" &&
    data.workouts.some((item) => item.id === dialog.initial?.id);
  const isExistingRoutine =
    dialog?.kind === "routine" &&
    data.routines.some((item) => item.id === dialog.initial?.id);
  const pageTitle =
    page === "dashboard"
      ? "대시보드"
      : page === "records"
        ? "운동 기록"
        : "나의 루틴";

  function closeDialog() {
    if (savingRef.current) return;
    if (
      (dialog?.kind === "workout" || dialog?.kind === "routine") &&
      !window.confirm("작성을 마칠까요? 저장하지 않은 내용은 사라져요.")
    )
      return;
    setDialog(null);
  }

  if (revision === null)
    return (
      <main className="cloud-state">
        <span className="brand-mark">
          <Icon name="dumbbell" size={26} />
        </span>
        <h1>
          {loading
            ? "운동 기록을 불러오는 중이에요"
            : "기록을 불러오지 못했어요"}
        </h1>
        <p>
          {loading ? "계정에 저장한 기록을 확인하고 있어요." : storageError}
        </p>
        {!loading && (
          <button
            className="button button-primary"
            onClick={() => {
              setLoading(true);
              void refreshCloud();
            }}
          >
            다시 시도
          </button>
        )}
        <button className="text-button" onClick={handleSignOut}>
          로그아웃
        </button>
      </main>
    );

  return (
    <div className="app-shell">
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("main-content")?.focus();
        }}
      >
        본문으로 이동
      </a>
      <aside className="sidebar">
        <a
          className="brand"
          href="#dashboard"
          onClick={() => navigate("dashboard")}
          aria-label="Gym Log 대시보드"
        >
          <span className="brand-mark">
            <Icon name="dumbbell" size={26} />
          </span>
          <span>
            gym<span className="brand-light">log</span>
            <span className="brand-dot">.</span>
          </span>
        </a>
        <div className="sidebar-label">MY WORKSPACE</div>
        <nav className="desktop-nav" aria-label="주 메뉴">
          {navigation.map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              className={`nav-link ${page === item.id ? "active" : ""}`}
              aria-current={page === item.id ? "page" : undefined}
              onClick={(event) => {
                event.preventDefault();
                navigate(item.id);
              }}
            >
              <Icon name={item.icon} />
              <span>{item.name}</span>
              {page === item.id && <span className="nav-dot" />}
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <span className="note-icon">
              <Icon name="leaf" size={23} />
            </span>
            <p>
              어제보다 조금 더,
              <br />
              <strong>나만의 속도로.</strong>
            </p>
            <span>작은 기록이 큰 변화를 만들어요.</span>
          </div>
          <button
            className="nav-link"
            onClick={() => setDialog({ kind: "settings" })}
          >
            <Icon name="settings" />
            <span>데이터 관리</span>
          </button>
          <div className="sidebar-profile">
            <span className="avatar">ME</span>
            <div>
              <strong>{user.name || "나의 운동 공간"}</strong>
              <span>계정에 연결된 기록</span>
            </div>
            <span className="online-dot" />
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <span className="mobile-brand">
              <Icon name="dumbbell" size={21} /> gym<strong>log.</strong>
            </span>
            <span className="desktop-breadcrumb">
              내 운동 공간 <Icon name="chevronRight" size={14} />{" "}
              <strong>{pageTitle}</strong>
            </span>
          </div>
          <div className="topbar-right">
            <span className="today-date">
              <Icon name="calendar" size={16} />
              {displayDate(today, {
                year: "numeric",
                month: "long",
                day: "numeric",
                weekday: "long",
              })}
            </span>
            <button
              className="avatar avatar-button"
              aria-label="데이터 관리 열기"
              onClick={() => setDialog({ kind: "settings" })}
            >
              ME
            </button>
          </div>
        </header>
        <main id="main-content" className="main-content" tabIndex={-1}>
          {storageError && (
            <div className="storage-error" role="alert">
              <Icon name="info" />
              <div>
                {storageError}
                <button
                  onClick={() => {
                    void refreshCloud();
                  }}
                >
                  서버 기록 다시 불러오기
                </button>
              </div>
            </div>
          )}
          {legacy.data && (
            <div className="legacy-banner">
              <Icon name="upload" size={20} />
              <div>
                <strong>이 브라우저에 이전 기록이 남아있어요</strong>
                <p>
                  운동 {legacy.data.workouts.length}개 · 루틴{" "}
                  {legacy.data.routines.length}개를 계정에 추가할 수 있어요.
                </p>
              </div>
              <button
                className="button button-secondary"
                disabled={saving}
                onClick={importLegacy}
              >
                가져오기
              </button>
            </div>
          )}
          {page === "dashboard" ? (
            <>
              <section className="hero">
                <div className="hero-content">
                  <div className="eyebrow">
                    <span /> EVERY REP COUNTS
                  </div>
                  <h1>
                    오늘도, 한 세트 더<span className="heading-dot">.</span>
                  </h1>
                  <p>오늘의 노력을 기록하고, 어제의 나를 넘어보세요.</p>
                  <button
                    className="button button-primary hero-button"
                    onClick={() => setDialog({ kind: "workout" })}
                  >
                    <Icon name="plus" size={19} /> 운동 기록하기{" "}
                    <Icon name="arrow" size={18} />
                  </button>
                </div>
                <div className="hero-art" aria-hidden="true">
                  <div className="orbit orbit-one" />
                  <div className="orbit orbit-two" />
                  <div className="orbit orbit-three" />
                  <div className="hero-plate">
                    <div className="plate-inner">
                      <Icon name="dumbbell" size={48} />
                      <span>ONE MORE REP</span>
                    </div>
                  </div>
                  <span className="hero-art-label">BUILD YOUR OWN PACE ↗</span>
                  <span className="hero-plus">+</span>
                </div>
              </section>
              <section className="stats-grid" aria-label="이번 주 운동 요약">
                <div className="stat-card">
                  <div className="stat-heading">
                    <span>이번 주 운동</span>
                    <span className="stat-icon green">
                      <Icon name="flame" />
                    </span>
                  </div>
                  <div className="stat-value">
                    {activeWeekDays}
                    <span>일</span>
                    <div className="mini-week" aria-hidden="true">
                      {thisWeek.map((date) => (
                        <i
                          key={date}
                          className={workoutDays.has(date) ? "filled" : ""}
                        />
                      ))}
                    </div>
                  </div>
                  <p>일주일의 작은 습관을 쌓아가요</p>
                </div>
                <div className="stat-card">
                  <div className="stat-heading">
                    <span>이번 주 총 볼륨</span>
                    <span className="stat-icon tan">
                      <Icon name="dumbbell" />
                    </span>
                  </div>
                  <div className="stat-value">
                    {number(
                      weekWorkouts.reduce(
                        (sum, item) => sum + workoutVolume(item.exercises),
                        0,
                      ),
                    )}
                    <span>kg</span>
                  </div>
                  <p>세트별 무게 × 횟수의 합계</p>
                </div>
                <div className="stat-card">
                  <div className="stat-heading">
                    <span>쌓아온 운동 기록</span>
                    <span className="stat-icon lilac">
                      <Icon name="note" />
                    </span>
                  </div>
                  <div className="stat-value">
                    {data.workouts.length}
                    <span>회</span>
                    <span className="stat-caption">ALL TIME</span>
                  </div>
                  <p>
                    {data.workouts.length > 0
                      ? `${displayDate(sortedWorkouts[sortedWorkouts.length - 1].date, { year: "numeric", month: "long", day: "numeric" })}부터 함께하고 있어요`
                      : "오늘, 첫 번째 기록을 시작해보세요"}
                  </p>
                </div>
              </section>
              <section className="week-card panel">
                <div className="section-heading">
                  <div className="section-title">
                    <Icon name="calendar" size={19} />
                    <h2>꾸준함의 기록</h2>
                    <span className="section-description">
                      한 주를 채우는 나의 움직임
                    </span>
                  </div>
                  <div className="week-controls">
                    <button
                      className="icon-button"
                      aria-label="이전 주"
                      onClick={() => setWeekOffset((value) => value - 1)}
                    >
                      <Icon name="chevronLeft" size={17} />
                    </button>
                    <span>
                      {dateObject(weeks[0]).getMonth() + 1}.
                      {dateObject(weeks[0]).getDate()} –{" "}
                      {dateObject(weeks[6]).getMonth() + 1}.
                      {dateObject(weeks[6]).getDate()}
                    </span>
                    <button
                      className="icon-button"
                      aria-label="다음 주"
                      disabled={weekOffset === 0}
                      onClick={() => setWeekOffset((value) => value + 1)}
                    >
                      <Icon name="chevronRight" size={17} />
                    </button>
                  </div>
                </div>
                <div className="week-days">
                  {weeks.map((date, index) => (
                    <button
                      key={date}
                      className={`week-day ${date === today ? "is-today" : ""} ${workoutDays.has(date) ? "has-workout" : ""}`}
                      disabled={date > today}
                      aria-label={`${displayDate(date)} ${workoutDays.has(date) ? "운동 기록 보기" : "기록 없음"}`}
                      onClick={() => {
                        navigate("records");
                        setDateFilter(date);
                      }}
                    >
                      <span className="day-name">
                        {["월", "화", "수", "목", "금", "토", "일"][index]}
                      </span>
                      <span className="day-number">
                        {dateObject(date).getDate()}
                        {workoutDays.has(date) && (
                          <i>
                            <Icon name="check" size={10} />
                          </i>
                        )}
                      </span>
                      <span className="day-status">
                        {date === today
                          ? "오늘"
                          : workoutDays.has(date)
                            ? "운동 완료"
                            : "—"}
                      </span>
                    </button>
                  ))}
                </div>
                <div className="week-footer">
                  <span>
                    <i className="legend-dot" /> 운동한 날
                  </span>
                  <span>
                    {weekOffset === 0 ? "이번 주" : "이 주"}{" "}
                    <strong>
                      {weeks.filter((date) => workoutDays.has(date)).length}일
                    </strong>
                    의 노력이 쌓였어요
                  </span>
                </div>
              </section>
              <div className="dashboard-columns">
                <section className="recent-section">
                  <div className="section-heading">
                    <div className="section-title">
                      <h2>최근 운동 기록</h2>
                      <span className="count-badge">
                        {data.workouts.length}
                      </span>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => navigate("records")}
                    >
                      전체 보기 <Icon name="chevronRight" size={15} />
                    </button>
                  </div>
                  <div className="panel recent-panel">
                    {sortedWorkouts.length > 0 ? (
                      sortedWorkouts
                        .slice(0, 3)
                        .map((workout) => (
                          <RecordCard
                            key={workout.id}
                            workout={workout}
                            onOpen={(workout) =>
                              setDialog({ kind: "detail", workout })
                            }
                          />
                        ))
                    ) : (
                      <div className="empty-state">
                        <div className="empty-illustration">
                          <span className="empty-line line-one" />
                          <span className="empty-line line-two" />
                          <span className="empty-icon">
                            <Icon name="dumbbell" size={33} />
                          </span>
                          <span className="tiny-sparkle">+</span>
                        </div>
                        <h3>첫 기록이 변화의 시작이에요</h3>
                        <p>
                          운동 종목, 무게, 횟수를 남겨보세요.
                          <br />
                          하나씩 쌓이는 기록이 나의 성장이 됩니다.
                        </p>
                        <button
                          className="text-button green-text"
                          onClick={() => setDialog({ kind: "workout" })}
                        >
                          첫 운동 기록하기 <Icon name="arrow" size={16} />
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="small-tip">
                    <Icon name="sparkle" size={19} />
                    <p>
                      완벽한 하루보다 <strong>꾸준한 한 세트.</strong> 오늘도
                      나에게 집중해요.
                    </p>
                  </div>
                </section>
                <section className="quick-routines">
                  <div className="section-heading">
                    <div className="section-title">
                      <h2>나의 루틴</h2>
                      <span className="count-badge">
                        {data.routines.length}
                      </span>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => navigate("routines")}
                    >
                      전체 보기 <Icon name="chevronRight" size={15} />
                    </button>
                  </div>
                  <div className="quick-routine-list">
                    {data.routines.slice(0, 3).map((routine, index) => (
                      <button
                        key={routine.id}
                        className="quick-routine-card"
                        onClick={() => startRoutine(routine)}
                        aria-label={`${routine.name}으로 운동 시작`}
                      >
                        <span className={`routine-symbol symbol-${index % 3}`}>
                          <Icon name="dumbbell" size={23} />
                        </span>
                        <span className="quick-routine-info">
                          <strong>{routine.name}</strong>
                          <span>
                            {getGroups(routine.exercises).join(" · ")}
                            <i />
                            {routine.exercises.length}개 운동 ·{" "}
                            {countSets(routine.exercises)}세트
                          </span>
                        </span>
                        <Icon name="arrow" size={18} />
                      </button>
                    ))}
                  </div>
                  <button
                    className="add-routine-button"
                    onClick={() => setDialog({ kind: "routine" })}
                  >
                    <Icon name="plus" size={18} /> 새 루틴 만들기
                  </button>
                </section>
              </div>
              <footer className="page-footer">
                <span>YOUR EFFORT. YOUR RECORD.</span>
                <span>
                  <span className="online-dot" /> 계정에 저장됩니다
                </span>
              </footer>
            </>
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">
                    {page === "records"
                      ? "MY WORKOUT JOURNAL"
                      : "MY TRAINING ROUTINES"}
                  </div>
                  <h1>
                    {pageTitle}
                    <span className="heading-dot">.</span>
                  </h1>
                  <p>
                    {page === "records"
                      ? "차곡차곡 쌓인 노력, 한눈에 돌아보세요."
                      : "나에게 맞는 루틴으로, 운동의 시작을 가볍게."}
                  </p>
                </div>
                <button
                  className="button button-primary"
                  onClick={() =>
                    setDialog({
                      kind: page === "records" ? "workout" : "routine",
                    })
                  }
                >
                  <Icon name="plus" size={18} />
                  {page === "records" ? "운동 기록하기" : "새 루틴 만들기"}
                </button>
              </div>
              <div className="filter-bar">
                <div className="chips" aria-label="운동 부위 필터">
                  {(["전체", ...MUSCLE_GROUPS] as const).map((group) => (
                    <button
                      key={group}
                      className={`chip ${groupFilter === group ? "chip-active" : ""}`}
                      aria-pressed={groupFilter === group}
                      onClick={() => setGroupFilter(group)}
                    >
                      {group}
                    </button>
                  ))}
                </div>
                <div className="filter-inputs">
                  <label className="search-input">
                    <Icon name="search" size={17} />
                    <input
                      aria-label={
                        page === "records" ? "운동 기록 검색" : "루틴 검색"
                      }
                      placeholder={
                        page === "records"
                          ? "기록, 운동 이름 검색"
                          : "루틴, 운동 이름 검색"
                      }
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                    />
                  </label>
                  {page === "records" && (
                    <select
                      className="input month-select"
                      aria-label="기록 월 선택"
                      value={monthFilter}
                      onChange={(event) => {
                        setMonthFilter(event.target.value);
                        setDateFilter("");
                      }}
                    >
                      <option value="">전체 기간</option>
                      {[
                        ...new Set(
                          sortedWorkouts.map((workout) =>
                            workout.date.slice(0, 7),
                          ),
                        ),
                      ].map((month) => (
                        <option key={month} value={month}>
                          {month.replace("-", "년 ")}월
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
              {dateFilter && (
                <div className="date-filter">
                  <Icon name="calendar" size={16} />
                  {displayDate(dateFilter)}
                  <button
                    className="icon-button"
                    aria-label="날짜 필터 해제"
                    onClick={() => setDateFilter("")}
                  >
                    <Icon name="x" size={16} />
                  </button>
                </div>
              )}
              {page === "records" ? (
                <section className="records-section">
                  <p className="results-count">
                    총 <strong>{visibleWorkouts.length}</strong>개의 기록
                  </p>
                  {visibleWorkouts.length > 0 ? (
                    <div className="panel records-list">
                      {visibleWorkouts.map((workout) => (
                        <RecordCard
                          key={workout.id}
                          workout={workout}
                          onOpen={(workout) =>
                            setDialog({ kind: "detail", workout })
                          }
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="panel empty-state large-empty">
                      <span className="empty-icon">
                        <Icon name="calendar" size={32} />
                      </span>
                      <h3>
                        {data.workouts.length
                          ? "조건에 맞는 기록이 없어요"
                          : dateFilter
                            ? "이날의 기록이 아직 없어요"
                            : "아직 운동 기록이 없어요"}
                      </h3>
                      <p>
                        {data.workouts.length
                          ? "다른 부위나 기간으로 찾아보세요."
                          : "작은 시작도 좋아요. 오늘의 운동을 남겨보세요."}
                      </p>
                      <button
                        className="button button-primary"
                        onClick={() =>
                          setDialog({
                            kind: "workout",
                            ...(dateFilter
                              ? {
                                  initial: {
                                    id: uid(),
                                    name: "",
                                    date: dateFilter,
                                    duration: 0,
                                    notes: "",
                                    exercises: [],
                                    createdAt: new Date().toISOString(),
                                  },
                                }
                              : {}),
                          })
                        }
                      >
                        <Icon name="plus" size={18} />
                        {dateFilter ? "이날 운동 기록하기" : "운동 기록하기"}
                      </button>
                    </div>
                  )}
                </section>
              ) : (
                <section>
                  <div className="routine-intro">
                    <Icon name="info" size={17} />
                    <p>
                      기본 루틴을 내게 맞게 수정하거나 직접 만들어보세요. 무게와
                      횟수는 운동할 때마다 바꿀 수 있어요.
                    </p>
                  </div>
                  <div className="routines-grid">
                    {visibleRoutines.map((routine, index) => (
                      <article className="routine-card panel" key={routine.id}>
                        <div className="routine-card-top">
                          <span
                            className={`routine-symbol symbol-${index % 3}`}
                          >
                            <Icon name="dumbbell" size={28} />
                          </span>
                          <div className="routine-card-actions">
                            <button
                              className="icon-button"
                              aria-label={`${routine.name} 수정`}
                              onClick={() =>
                                setDialog({ kind: "routine", initial: routine })
                              }
                            >
                              <Icon name="edit" size={17} />
                            </button>
                            <button
                              className="icon-button"
                              aria-label={`${routine.name} 삭제`}
                              onClick={() => deleteRoutine(routine)}
                            >
                              <Icon name="trash" size={17} />
                            </button>
                          </div>
                        </div>
                        <GroupTags groups={getGroups(routine.exercises)} />
                        <h2>{routine.name}</h2>
                        <p className="routine-description">
                          {routine.description ||
                            "나만의 운동 흐름을 만들어가요."}
                        </p>
                        <div className="routine-exercises">
                          {routine.exercises.map((exercise) => (
                            <div key={exercise.id}>
                              <span>{exercise.name}</span>
                              <span>{exercise.sets.length}세트</span>
                            </div>
                          ))}
                        </div>
                        <div className="routine-card-bottom">
                          <span>
                            {routine.exercises.length}개 운동 ·{" "}
                            {countSets(routine.exercises)}세트
                          </span>
                          <button
                            className="button button-secondary"
                            onClick={() => startRoutine(routine)}
                          >
                            운동 시작 <Icon name="arrow" size={16} />
                          </button>
                        </div>
                      </article>
                    ))}
                    <button
                      className="new-routine-card"
                      onClick={() => setDialog({ kind: "routine" })}
                    >
                      <span className="empty-icon">
                        <Icon name="plus" size={25} />
                      </span>
                      <strong>나만의 루틴 만들기</strong>
                      <span>좋아하는 운동을 하나로 모아보세요</span>
                    </button>
                  </div>
                  {visibleRoutines.length === 0 && data.routines.length > 0 && (
                    <p className="muted">
                      조건에 맞는 루틴이 없어요. 검색어나 운동 부위를
                      바꿔보세요.
                    </p>
                  )}
                </section>
              )}
            </>
          )}
        </main>
      </div>
      <nav className="mobile-nav" aria-label="모바일 주 메뉴">
        {navigation.map((item) => (
          <a
            key={item.id}
            href={`#${item.id}`}
            className={page === item.id ? "active" : ""}
            aria-current={page === item.id ? "page" : undefined}
            onClick={(event) => {
              event.preventDefault();
              navigate(item.id);
            }}
          >
            <Icon name={item.icon} size={22} />
            <span>{item.name}</span>
          </a>
        ))}
      </nav>
      {toast && !dialog && (
        <div className="toast" role="status">
          <Icon name="info" size={19} />
          <span>{toast}</span>
          <button
            className="icon-button"
            aria-label="알림 닫기"
            onClick={() => setToast("")}
          >
            <Icon name="x" size={16} />
          </button>
        </div>
      )}
      {dialog && (
        <Modal
          wide={dialog.kind === "workout" || dialog.kind === "routine"}
          title={
            dialog.kind === "workout"
              ? isExistingWorkout
                ? "운동 기록 수정"
                : "오늘의 운동 기록"
              : dialog.kind === "routine"
                ? isExistingRoutine
                  ? "루틴 수정"
                  : "새 루틴 만들기"
                : dialog.kind === "detail"
                  ? dialog.workout.name
                  : "데이터 관리"
          }
          subtitle={
            dialog.kind === "workout"
              ? "한 세트씩, 오늘의 노력을 남겨보세요."
              : dialog.kind === "routine"
                ? "다시 꺼내 쓰고 싶은 나만의 운동 조합."
                : dialog.kind === "detail"
                  ? displayDate(dialog.workout.date, {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                      weekday: "long",
                    })
                  : "소중한 기록을 파일로 보관하고 다시 불러오세요."
          }
          onClose={closeDialog}
          feedback={
            toast && (
              <div className="modal-feedback" role="status">
                <Icon name="info" size={17} />
                <span>{toast}</span>
                <button
                  className="icon-button"
                  aria-label="알림 닫기"
                  onClick={() => setToast("")}
                >
                  <Icon name="x" size={16} />
                </button>
              </div>
            )
          }
        >
          {conflict && (
            <p className="form-error" role="alert">
              다른 기기에서 변경한 서버 기록을 불러왔어요. 작성 중인 내용은
              유지됩니다. 변경 내용을 확인한 뒤 다시 저장해주세요.
            </p>
          )}
          {(dialog.kind === "workout" || dialog.kind === "routine") && (
            <WorkoutEditor
              key={`${dialog.kind}-${dialog.initial?.id ?? "new"}`}
              mode={dialog.kind}
              busy={saving}
              isEditing={!!isExistingWorkout}
              initial={dialog.initial}
              routines={data.routines}
              onSave={dialog.kind === "workout" ? saveWorkout : saveRoutine}
              onCancel={closeDialog}
            />
          )}
          {dialog.kind === "detail" && (
            <>
              <GroupTags groups={getGroups(dialog.workout.exercises)} />
              <div className="detail-stats">
                <div>
                  <span>운동</span>
                  <strong>
                    {dialog.workout.exercises.length}
                    <small>종목</small>
                  </strong>
                </div>
                <div>
                  <span>세트</span>
                  <strong>
                    {countSets(dialog.workout.exercises)}
                    <small>세트</small>
                  </strong>
                </div>
                <div>
                  <span>총 볼륨</span>
                  <strong>
                    {number(workoutVolume(dialog.workout.exercises))}
                    <small>kg</small>
                  </strong>
                </div>
                {dialog.workout.duration > 0 && (
                  <div>
                    <span>운동 시간</span>
                    <strong>
                      {dialog.workout.duration}
                      <small>분</small>
                    </strong>
                  </div>
                )}
              </div>
              <div className="detail-exercises">
                {dialog.workout.exercises.map((exercise) => (
                  <section key={exercise.id}>
                    <div className="section-heading">
                      <h3>{exercise.name}</h3>
                      <GroupTags groups={[exercise.group]} />
                    </div>
                    <table>
                      <thead>
                        <tr>
                          <th scope="col">세트</th>
                          <th scope="col">무게</th>
                          <th scope="col">횟수</th>
                          <th scope="col">볼륨</th>
                        </tr>
                      </thead>
                      <tbody>
                        {exercise.sets.map((set, index) => (
                          <tr key={set.id}>
                            <td>{index + 1}</td>
                            <td>{number(set.weight)} kg</td>
                            <td>{set.reps}회</td>
                            <td>{number(set.weight * set.reps)} kg</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </section>
                ))}
              </div>
              {dialog.workout.notes && (
                <div className="detail-notes">
                  <span>
                    <Icon name="note" size={16} /> 오늘의 메모
                  </span>
                  <p>{dialog.workout.notes}</p>
                </div>
              )}
              <div className="detail-actions">
                <button
                  className="button button-danger"
                  onClick={() => {
                    if (dialog.kind === "detail") deleteWorkout(dialog.workout);
                  }}
                >
                  <Icon name="trash" size={16} />
                  삭제
                </button>
                <button
                  className="button button-secondary"
                  onClick={() =>
                    setDialog({
                      kind: "routine",
                      initial: {
                        id: uid(),
                        name: dialog.workout.name,
                        description: "",
                        exercises: cloneExercises(dialog.workout.exercises),
                        createdAt: new Date().toISOString(),
                      },
                    })
                  }
                >
                  <Icon name="layers" size={16} />
                  루틴으로 저장
                </button>
                <button
                  className="button button-primary"
                  onClick={() =>
                    setDialog({ kind: "workout", initial: dialog.workout })
                  }
                >
                  <Icon name="edit" size={16} />
                  수정
                </button>
              </div>
            </>
          )}
          {dialog.kind === "settings" && (
            <>
              <div className="storage-notice">
                <span className="stat-icon green">
                  <Icon name="layers" size={22} />
                </span>
                <h3>내 계정에 기록을 저장해요</h3>
                <p>
                  같은 계정으로 로그인하면 다른 기기에서도 운동 기록과 루틴을
                  사용할 수 있어요. 변경 내용은 저장이 완료된 뒤 반영됩니다.
                </p>
              </div>
              <div className="account-summary">
                <strong>{user.name}</strong>
                <span>{user.email}</span>
                <small>
                  {syncedAt
                    ? `${syncedAt.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })} 서버 기록 확인`
                    : ""}
                </small>
              </div>
              <div className="account-actions">
                <button
                  className="button button-secondary"
                  disabled={saving}
                  onClick={() => {
                    void refreshCloud().then((ok) => {
                      if (ok) setToast("최신 기록을 불러왔어요.");
                    });
                  }}
                >
                  최신 기록 불러오기
                </button>
                <button
                  className="button button-ghost"
                  disabled={saving}
                  onClick={handleSignOut}
                >
                  로그아웃
                </button>
              </div>
              {legacy.error && (
                <div className="storage-error">
                  <p>{legacy.error}</p>
                  <button
                    className="text-button"
                    onClick={() => {
                      if (legacy.raw)
                        downloadJson(
                          legacy.raw,
                          `gym-log-browser-${today}.json`,
                        );
                    }}
                  >
                    이전 데이터 원본 내보내기
                  </button>
                </div>
              )}
              {legacy.data && (
                <button
                  className="backup-action"
                  disabled={saving}
                  onClick={importLegacy}
                >
                  <Icon name="upload" size={22} />
                  <span>
                    <strong>이전 브라우저 기록 가져오기</strong>
                    <span>서버 기록을 유지하고 이전 기록을 추가</span>
                  </span>
                </button>
              )}
              <div className="backup-summary">
                <span>
                  운동 기록 <strong>{data.workouts.length}개</strong>
                </span>
                <span>
                  나의 루틴 <strong>{data.routines.length}개</strong>
                </span>
              </div>
              <button
                className="backup-action"
                onClick={exportBackup}
                disabled={saving}
              >
                <Icon name="download" size={22} />
                <span>
                  <strong>백업 내보내기</strong>
                  <span>모든 기록과 루틴을 JSON 파일로 저장</span>
                </span>
                <Icon name="chevronRight" size={18} />
              </button>
              <button
                className="backup-action"
                disabled={saving}
                onClick={() => importRef.current?.click()}
              >
                <Icon name="upload" size={22} />
                <span>
                  <strong>백업 가져오기</strong>
                  <span>저장해둔 파일로 현재 계정의 기록 교체</span>
                </span>
                <Icon name="chevronRight" size={18} />
              </button>
              <input
                ref={importRef}
                type="file"
                accept=".json,application/json"
                hidden
                onChange={importBackup}
              />
              <p className="backup-footnote">
                백업을 가져오면 이 계정의 기록과 루틴이 교체되고 다른 기기에도
                반영됩니다.
              </p>
            </>
          )}
        </Modal>
      )}
    </div>
  );
}
