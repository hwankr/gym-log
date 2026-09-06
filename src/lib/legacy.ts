import { parseBackup, STORAGE_KEY, uid, type GymData } from "./gym.ts";

function comparableRecord(value: unknown): string {
  return JSON.stringify(value, (key, entry: unknown) => {
    if (key === "createdAt" && typeof entry === "string") {
      const timestamp = new Date(entry);
      if (Number.isFinite(timestamp.getTime())) return timestamp.toISOString();
    }
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      return Object.fromEntries(
        Object.entries(entry).sort(([left], [right]) => left.localeCompare(right)),
      );
    }
    return entry;
  });
}

export function legacyStorageStatus(userId: string): {
  data: GymData | null;
  error: string | null;
  raw: string | null;
} {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw || localStorage.getItem(`gym-log:imported:${userId}`) === raw)
      return { data: null, error: null, raw: null };
    try {
      return { data: parseBackup(raw), error: null, raw };
    } catch {
      return {
        data: null,
        error:
          "이전 브라우저 기록을 읽지 못했어요. 원본 파일을 내보내 확인할 수 있어요.",
        raw,
      };
    }
  } catch {
    return { data: null, error: null, raw: null };
  }
}

/** Keep cloud records; preserve different legacy records under a new ID. */
export function mergeLegacyData(current: GymData, legacy: GymData): GymData {
  function merge<T extends { id: string; name: string }>(
    currentItems: T[],
    incoming: T[],
  ): T[] {
    const result = structuredClone(currentItems);
    for (const item of incoming) {
      const existing = result.find((value) => value.id === item.id);
      if (!existing) result.push(structuredClone(item));
      else if (comparableRecord(existing) !== comparableRecord(item))
        result.push({
          ...structuredClone(item),
          id: uid(),
          name: `${item.name.slice(0, 150)} (가져옴)`,
        });
    }
    return result;
  }
  return {
    version: 1,
    workouts: merge(current.workouts, legacy.workouts),
    routines: merge(current.routines, legacy.routines),
  };
}
