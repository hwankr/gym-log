import assert from "node:assert/strict";
import { test } from "node:test";
import {
  INITIAL_DATA,
  STORAGE_KEY,
  cloneExercises,
  countSets,
  getGroups,
  loadData,
  localDate,
  parseBackup,
  saveData,
  validateData,
  workoutVolume,
} from "./gym.ts";
import type { GymData, Workout } from "./gym.ts";

function makeData(): GymData {
  const data = structuredClone(INITIAL_DATA);
  const workout: Workout = {
    id: "workout-1",
    name: "오늘의 운동",
    date: "2026-09-05",
    duration: 45,
    notes: "컨디션 좋음",
    exercises: cloneExercises(data.routines[0].exercises),
    createdAt: "2026-09-05T03:00:00.000Z",
  };
  data.workouts.push(workout);
  return data;
}

function withStorage<T>(
  storage: Pick<Storage, "getItem" | "setItem">,
  action: () => T,
): T {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
  });
  try {
    return action();
  } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
}

test("initial state has no invented workout history and valid editable presets", () => {
  assert.equal(validateData(INITIAL_DATA), true);
  assert.equal(INITIAL_DATA.workouts.length, 0);
  assert.equal(INITIAL_DATA.routines.length, 3);
  assert.equal(
    INITIAL_DATA.routines.every((routine) =>
      routine.exercises.every((exercise) => exercise.sets.length === 3),
    ),
    true,
  );
});

test("starting from a routine gives every exercise and set independent identities", () => {
  const original = structuredClone(INITIAL_DATA.routines[0].exercises);
  const exercises = cloneExercises(original);
  const another = cloneExercises(original);
  const originalIds = new Set(
    original.flatMap((exercise) => [
      exercise.id,
      ...exercise.sets.map((set) => set.id),
    ]),
  );
  const newIds = [exercises, another].flatMap((group) =>
    group.flatMap((exercise) => [
      exercise.id,
      ...exercise.sets.map((set) => set.id),
    ]),
  );
  assert.equal(new Set(newIds).size, newIds.length);
  assert.equal(
    newIds.some((id) => originalIds.has(id)),
    false,
  );
  exercises[0].sets[0].weight = 100;
  assert.equal(original[0].sets[0].weight, 40);
  assert.equal(another[0].sets[0].weight, 40);
});

test("volume uses all sets, including decimals and bodyweight zero", () => {
  const exercises = cloneExercises(INITIAL_DATA.routines[0].exercises);
  exercises[0].sets = [
    { id: "a", weight: 42.5, reps: 10 },
    { id: "b", weight: 0, reps: 12 },
  ];
  exercises[1].sets = [{ id: "c", weight: 35, reps: 8 }];
  exercises[2].sets = [{ id: "d", weight: 8, reps: 12 }];
  assert.equal(workoutVolume(exercises), 801);
  assert.equal(countSets(exercises), 4);
  assert.deepEqual(getGroups(exercises), ["등", "이두"]);
  assert.equal(workoutVolume([]), 0);
  assert.equal(countSets([]), 0);
});

test("local calendar date is computed from local date parts", () => {
  assert.equal(localDate(new Date(2026, 0, 2, 0, 5)), "2026-01-02");
  assert.equal(localDate(new Date(2026, 11, 31, 23, 55)), "2026-12-31");
});

test("backup validation accepts boundary values and valid leap dates", () => {
  const data = makeData();
  data.workouts[0].date = "2024-02-29";
  data.workouts[0].duration = 1440;
  data.workouts[0].exercises[0].sets = [
    { id: "minimum", weight: 0, reps: 1 },
    { id: "maximum", weight: 2000, reps: 1000 },
  ];
  assert.equal(validateData(data), true);
  assert.deepEqual(parseBackup(JSON.stringify(data)), data);
});

test("backup validation rejects invalid date, schema, IDs, and numerical values", () => {
  const mutations: ((data: GymData) => void)[] = [
    (data) => {
      data.workouts[0].date = "2026-02-29";
    },
    (data) => {
      data.workouts[0].date = "2026-04-31";
    },
    (data) => {
      data.workouts[0].name = "  ";
    },
    (data) => {
      data.workouts[0].createdAt = "2026-02-30T03:00:00.000Z";
    },
    (data) => {
      data.workouts[0].duration = 1441;
    },
    (data) => {
      data.workouts[0].duration = -1;
    },
    (data) => {
      data.workouts[0].exercises[0].sets[0].weight = -1;
    },
    (data) => {
      data.workouts[0].exercises[0].sets[0].weight = 2001;
    },
    (data) => {
      data.workouts[0].exercises[0].sets[0].weight = Infinity;
    },
    (data) => {
      data.workouts[0].exercises[0].sets[0].reps = 0;
    },
    (data) => {
      data.workouts[0].exercises[0].sets[0].reps = 1001;
    },
    (data) => {
      data.workouts[0].exercises[0].sets[0].reps = 1.5;
    },
    (data) => {
      data.workouts[0].exercises[0].sets = [];
    },
    (data) => {
      data.workouts[0].exercises = [];
    },
    (data) => {
      data.workouts.push(data.workouts[0]);
    },
    (data) => {
      data.workouts[0].exercises.push(data.workouts[0].exercises[0]);
    },
    (data) => {
      data.workouts[0].exercises[0].sets.push(
        data.workouts[0].exercises[0].sets[0],
      );
    },
  ];
  for (const mutation of mutations) {
    const data = makeData();
    mutation(data);
    assert.equal(validateData(data), false, mutation.toString());
  }
  for (const value of [
    null,
    [],
    {},
    { version: 2, workouts: [], routines: [] },
    { version: 1, workouts: {}, routines: [] },
  ]) {
    assert.equal(validateData(value), false);
  }
  assert.throws(() => parseBackup("{broken"), /JSON 백업/);
  assert.throws(() => parseBackup('{"version":2}'), /백업 형식/);
});

test("first load returns independent defaults without writing storage", () => {
  withStorage(
    { getItem: () => null, setItem: () => assert.fail("load must not write") },
    () => {
      const first = loadData();
      assert.equal(first.error, null);
      first.data.routines[0].exercises[0].sets[0].weight = 999;
      assert.equal(loadData().data.routines[0].exercises[0].sets[0].weight, 40);
    },
  );
});

test("bad saved data is preserved and returned with an actionable Korean error", () => {
  for (const raw of ["{broken", '{"version":99,"workouts":[],"routines":[]}']) {
    withStorage(
      {
        getItem: () => raw,
        setItem: () => assert.fail("malformed storage must be preserved"),
      },
      () => {
        const result = loadData();
        assert.match(result.error ?? "", /기존 데이터는 보존/);
        assert.equal(result.data.workouts.length, 0);
      },
    );
  }
});

test("saved workouts round-trip and invalid updates do not overwrite existing storage", () => {
  let stored: string | null = null;
  withStorage(
    {
      getItem: (key) => {
        assert.equal(key, STORAGE_KEY);
        return stored;
      },
      setItem: (key, value) => {
        assert.equal(key, STORAGE_KEY);
        stored = value;
      },
    },
    () => {
      const data = makeData();
      assert.equal(saveData(data), null);
      assert.deepEqual(loadData(), { data, error: null });
      const previous = stored;
      data.workouts[0].exercises[0].sets[0].reps = 0;
      assert.match(saveData(data) ?? "", /횟수/);
      assert.equal(stored, previous);
    },
  );
});

test("blocked storage and quota failures produce errors instead of throwing", () => {
  withStorage(
    {
      getItem: () => {
        throw new DOMException("Blocked", "SecurityError");
      },
      setItem: () => {
        throw new DOMException("Full", "QuotaExceededError");
      },
    },
    () => {
      assert.match(loadData().error ?? "", /저장소를 읽을 수 없어요/);
      assert.match(saveData(makeData()) ?? "", /저장 공간이 부족/);
    },
  );
});
