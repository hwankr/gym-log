export const MUSCLE_GROUPS = [
  "등",
  "이두",
  "가슴",
  "삼두",
  "어깨",
  "하체",
] as const;
export type MuscleGroup = (typeof MUSCLE_GROUPS)[number];

export interface ExerciseSet {
  id: string;
  weight: number;
  reps: number;
}

export interface WorkoutExercise {
  id: string;
  name: string;
  group: MuscleGroup;
  sets: ExerciseSet[];
}

export interface Workout {
  id: string;
  name: string;
  date: string;
  duration: number;
  notes: string;
  exercises: WorkoutExercise[];
  createdAt: string;
}

export interface Routine {
  id: string;
  name: string;
  description: string;
  exercises: WorkoutExercise[];
  createdAt: string;
}

export interface GymData {
  version: 1;
  workouts: Workout[];
  routines: Routine[];
}

export const STORAGE_KEY = "gym-log:data:v1";

export const EXERCISE_LIBRARY: { name: string; group: MuscleGroup }[] = [
  { name: "랫풀다운", group: "등" },
  { name: "시티드 케이블 로우", group: "등" },
  { name: "바벨 로우", group: "등" },
  { name: "원암 덤벨 로우", group: "등" },
  { name: "풀업", group: "등" },
  { name: "바벨 컬", group: "이두" },
  { name: "덤벨 컬", group: "이두" },
  { name: "해머 컬", group: "이두" },
  { name: "프리처 컬", group: "이두" },
  { name: "케이블 컬", group: "이두" },
  { name: "벤치 프레스", group: "가슴" },
  { name: "인클라인 덤벨 프레스", group: "가슴" },
  { name: "체스트 프레스", group: "가슴" },
  { name: "케이블 플라이", group: "가슴" },
  { name: "푸시업", group: "가슴" },
  { name: "케이블 푸시다운", group: "삼두" },
  { name: "오버헤드 익스텐션", group: "삼두" },
  { name: "라잉 트라이셉스 익스텐션", group: "삼두" },
  { name: "덤벨 킥백", group: "삼두" },
  { name: "딥스", group: "삼두" },
  { name: "숄더 프레스", group: "어깨" },
  { name: "사이드 레터럴 레이즈", group: "어깨" },
  { name: "리어 델트 플라이", group: "어깨" },
  { name: "페이스 풀", group: "어깨" },
  { name: "프론트 레이즈", group: "어깨" },
  { name: "스쿼트", group: "하체" },
  { name: "레그 프레스", group: "하체" },
  { name: "레그 익스텐션", group: "하체" },
  { name: "레그 컬", group: "하체" },
  { name: "루마니안 데드리프트", group: "하체" },
  { name: "런지", group: "하체" },
];

let fallbackId = 0;

export function uid(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  fallbackId += 1;
  return `${Date.now().toString(36)}-${fallbackId.toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** Calendar dates use the device's local timezone, including close to midnight. */
export function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function cloneExercises(
  exercises: WorkoutExercise[],
): WorkoutExercise[] {
  return exercises.map((exercise) => ({
    ...exercise,
    id: uid(),
    sets: exercise.sets.map((set) => ({ ...set, id: uid() })),
  }));
}

export function workoutVolume(exercises: WorkoutExercise[]): number {
  return exercises.reduce(
    (total, exercise) =>
      total +
      exercise.sets.reduce((sum, set) => sum + set.weight * set.reps, 0),
    0,
  );
}

export function countSets(exercises: WorkoutExercise[]): number {
  return exercises.reduce((total, exercise) => total + exercise.sets.length, 0);
}

export function getGroups(exercises: WorkoutExercise[]): MuscleGroup[] {
  return [...new Set(exercises.map((exercise) => exercise.group))];
}

function defaultExercise(
  id: string,
  name: string,
  group: MuscleGroup,
  weight: number,
  reps: number,
): WorkoutExercise {
  return {
    id,
    name,
    group,
    sets: Array.from({ length: 3 }, (_, index) => ({
      id: `${id}-set-${index + 1}`,
      weight,
      reps,
    })),
  };
}

const defaultCreatedAt = "2026-01-01T00:00:00.000Z";

export const INITIAL_DATA: GymData = {
  version: 1,
  workouts: [],
  routines: [
    {
      id: "routine-back-1",
      name: "등 루틴 1",
      description: "등을 탄탄하게, 당기는 날의 기본 루틴",
      createdAt: defaultCreatedAt,
      exercises: [
        defaultExercise("back-lat", "랫풀다운", "등", 40, 12),
        defaultExercise("back-row", "시티드 케이블 로우", "등", 35, 12),
        defaultExercise("back-curl", "덤벨 컬", "이두", 8, 12),
      ],
    },
    {
      id: "routine-chest-triceps",
      name: "가슴·삼두 루틴",
      description: "가슴과 삼두를 함께 채우는 푸시 루틴",
      createdAt: defaultCreatedAt,
      exercises: [
        defaultExercise("chest-bench", "벤치 프레스", "가슴", 40, 10),
        defaultExercise(
          "chest-incline",
          "인클라인 덤벨 프레스",
          "가슴",
          12,
          12,
        ),
        defaultExercise("chest-pushdown", "케이블 푸시다운", "삼두", 20, 12),
      ],
    },
    {
      id: "routine-legs",
      name: "하체 루틴",
      description: "스쿼트부터 차근차근, 단단한 하체 만들기",
      createdAt: defaultCreatedAt,
      exercises: [
        defaultExercise("legs-squat", "스쿼트", "하체", 40, 10),
        defaultExercise("legs-press", "레그 프레스", "하체", 80, 12),
        defaultExercise("legs-curl", "레그 컬", "하체", 25, 12),
      ],
    },
  ],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(
  value: unknown,
  maximum: number,
  required = false,
): value is string {
  return (
    typeof value === "string" &&
    value.length <= maximum &&
    (!required || value.trim().length > 0)
  );
}

function isNumberInRange(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const date = new Date(`${value}T12:00:00Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

function isTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) &&
    isCalendarDate(value.slice(0, 10)) &&
    !Number.isNaN(Date.parse(value))
  );
}

function hasUniqueIds(items: { id: string }[]): boolean {
  return new Set(items.map((item) => item.id)).size === items.length;
}

function isSet(value: unknown): value is ExerciseSet {
  return (
    isRecord(value) &&
    isText(value.id, 200, true) &&
    isNumberInRange(value.weight, 0, 2000) &&
    isNumberInRange(value.reps, 1, 1000) &&
    Number.isInteger(value.reps)
  );
}

function isExercise(value: unknown): value is WorkoutExercise {
  return (
    isRecord(value) &&
    isText(value.id, 200, true) &&
    isText(value.name, 160, true) &&
    MUSCLE_GROUPS.includes(value.group as MuscleGroup) &&
    Array.isArray(value.sets) &&
    value.sets.length > 0 &&
    value.sets.every(isSet) &&
    hasUniqueIds(value.sets)
  );
}

function isExercises(value: unknown): value is WorkoutExercise[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(isExercise) &&
    hasUniqueIds(value)
  );
}

function isWorkout(value: unknown): value is Workout {
  return (
    isRecord(value) &&
    isText(value.id, 200, true) &&
    isText(value.name, 160, true) &&
    isCalendarDate(value.date) &&
    isNumberInRange(value.duration, 0, 1440) &&
    isText(value.notes, 10000) &&
    isExercises(value.exercises) &&
    isTimestamp(value.createdAt)
  );
}

function isRoutine(value: unknown): value is Routine {
  return (
    isRecord(value) &&
    isText(value.id, 200, true) &&
    isText(value.name, 160, true) &&
    isText(value.description, 10000) &&
    isExercises(value.exercises) &&
    isTimestamp(value.createdAt)
  );
}

export function validateData(value: unknown): value is GymData {
  return (
    isRecord(value) &&
    value.version === 1 &&
    Array.isArray(value.workouts) &&
    value.workouts.every(isWorkout) &&
    hasUniqueIds(value.workouts) &&
    Array.isArray(value.routines) &&
    value.routines.every(isRoutine) &&
    hasUniqueIds(value.routines)
  );
}

export function parseBackup(serialized: string): GymData {
  let data: unknown;
  try {
    data = JSON.parse(serialized);
  } catch {
    throw new Error(
      "파일을 읽을 수 없어요. 올바른 JSON 백업 파일인지 확인해 주세요.",
    );
  }
  if (!validateData(data)) {
    throw new Error(
      "백업 형식이 올바르지 않아요. 운동 이름, 날짜, 무게, 횟수와 파일 버전을 확인해 주세요.",
    );
  }
  return data;
}

function freshInitialData(): GymData {
  return structuredClone(INITIAL_DATA);
}

/** Loading never mutates storage, so damaged records remain recoverable. */
export function loadData(): { data: GymData; error: string | null } {
  let serialized: string | null;
  try {
    serialized = globalThis.localStorage.getItem(STORAGE_KEY);
  } catch {
    return {
      data: freshInitialData(),
      error:
        "브라우저 저장소를 읽을 수 없어요. 저장소 접근 설정을 확인해 주세요.",
    };
  }
  if (serialized === null) return { data: freshInitialData(), error: null };
  try {
    return { data: parseBackup(serialized), error: null };
  } catch {
    return {
      data: freshInitialData(),
      error:
        "저장된 기록을 불러오지 못했어요. 기존 데이터는 보존했어요. 백업 파일로 복원해 주세요.",
    };
  }
}

export function saveData(data: GymData): string | null {
  if (!validateData(data)) {
    return "기록 형식이 올바르지 않아요. 무게는 0~2,000kg, 횟수는 1~1,000회, 운동 시간은 0~1,440분으로 입력해 주세요.";
  }
  try {
    globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return null;
  } catch (error) {
    if (
      error instanceof DOMException &&
      (error.name === "QuotaExceededError" ||
        error.name === "NS_ERROR_DOM_QUOTA_REACHED")
    ) {
      return "브라우저 저장 공간이 부족해요. 기록을 백업한 뒤 저장 공간을 확보해 주세요.";
    }
    return "기록을 저장하지 못했어요. 브라우저 저장소 접근 설정을 확인해 주세요.";
  }
}
