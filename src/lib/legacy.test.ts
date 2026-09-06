import assert from "node:assert/strict";
import { test } from "node:test";
import { INITIAL_DATA, STORAGE_KEY, validateData } from "./gym.ts";
import type { GymData } from "./gym.ts";
import { legacyStorageStatus, mergeLegacyData } from "./legacy.ts";

function dataWithWorkout(): GymData {
  const data = structuredClone(INITIAL_DATA);
  data.workouts.push({
    id: "workout-1",
    name: "오늘의 운동",
    date: "2026-09-05",
    duration: 45,
    notes: "메모",
    exercises: structuredClone(data.routines[0].exercises),
    createdAt: "2026-09-05T03:00:00.000Z",
  });
  return data;
}

function withStorage<T>(getItem: (key: string) => string | null, action: () => T): T {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem,
      setItem: () => assert.fail("reading legacy storage must not mutate it"),
      removeItem: () => assert.fail("reading legacy storage must not remove records"),
    },
  });
  try {
    return action();
  } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
}

test("legacy import retains cloud records and appends new workout and routine IDs", () => {
  const cloud = dataWithWorkout();
  const legacy = dataWithWorkout();
  legacy.workouts[0].id = "legacy-workout";
  legacy.routines[0].id = "legacy-routine";
  const result = mergeLegacyData(cloud, legacy);
  assert.deepEqual(result.workouts, [...cloud.workouts, legacy.workouts[0]]);
  assert.deepEqual(result.routines, [...cloud.routines, legacy.routines[0]]);
  assert.equal(validateData(result), true);
});

test("identical workout and routine records with the same IDs are deduplicated", () => {
  const cloud = dataWithWorkout();
  assert.deepEqual(mergeLegacyData(cloud, structuredClone(cloud)), cloud);
});

test("object property order and equivalent timestamp precision do not create duplicate imports", () => {
  const cloud = dataWithWorkout();
  const legacy = dataWithWorkout();
  legacy.workouts = legacy.workouts.map((workout) => ({
    createdAt: workout.createdAt.replace(".000Z", "Z"),
    notes: workout.notes,
    duration: workout.duration,
    date: workout.date,
    name: workout.name,
    id: workout.id,
    exercises: workout.exercises.map((exercise) => ({
      sets: exercise.sets.map((set) => ({ reps: set.reps, weight: set.weight, id: set.id })),
      group: exercise.group,
      name: exercise.name,
      id: exercise.id,
    })),
  }));
  legacy.routines = legacy.routines.map((routine) => ({
    exercises: routine.exercises,
    description: routine.description,
    name: routine.name,
    createdAt: routine.createdAt.replace(".000Z", ".0Z"),
    id: routine.id,
  }));
  assert.equal(validateData(legacy), true);
  assert.deepEqual(mergeLegacyData(cloud, legacy), cloud);
});

test("conflicting IDs copy legacy records with new IDs and names inside the validation limit", () => {
  const cloud = dataWithWorkout();
  const legacy = dataWithWorkout();
  legacy.workouts[0].name = "운".repeat(160);
  legacy.workouts[0].exercises[0].sets[0].weight = 42.5;
  legacy.routines[0].name = "루".repeat(160);
  legacy.routines[0].description = "이전 브라우저의 루틴";
  const result = mergeLegacyData(cloud, legacy);
  assert.deepEqual(result.workouts[0], cloud.workouts[0]);
  assert.deepEqual(result.routines.slice(0, 3), cloud.routines);
  const workoutCopy = result.workouts[1];
  const routineCopy = result.routines[3];
  assert.notEqual(workoutCopy.id, legacy.workouts[0].id);
  assert.notEqual(routineCopy.id, legacy.routines[0].id);
  assert.notEqual(workoutCopy.id, routineCopy.id);
  for (const copy of [workoutCopy, routineCopy]) {
    assert.ok(copy.name.length <= 160);
    assert.match(copy.name, / \(가져옴\)$/);
  }
  assert.equal(workoutCopy.exercises[0].sets[0].weight, 42.5);
  assert.equal(routineCopy.description, legacy.routines[0].description);
  assert.equal(validateData(result), true);
});

test("array order and actual timestamp differences remain meaningful changes", () => {
  const cloud = dataWithWorkout();
  const legacy = dataWithWorkout();
  legacy.routines[0].exercises.reverse();
  legacy.workouts[0].createdAt = "2026-09-05T03:00:00.001Z";
  const result = mergeLegacyData(cloud, legacy);
  assert.equal(result.workouts.length, 2);
  assert.equal(result.routines.length, 4);
  assert.deepEqual(result.routines[3].exercises, legacy.routines[0].exercises);
  assert.equal(result.workouts[1].createdAt, legacy.workouts[0].createdAt);
});

test("merging never mutates either source and returns independent nested records", () => {
  const cloud = dataWithWorkout();
  const legacy = dataWithWorkout();
  legacy.workouts[0].id = "new-workout";
  legacy.routines[0].description = "충돌하는 루틴";
  const originalCloud = structuredClone(cloud);
  const originalLegacy = structuredClone(legacy);
  const result = mergeLegacyData(cloud, legacy);
  assert.deepEqual(cloud, originalCloud);
  assert.deepEqual(legacy, originalLegacy);
  result.workouts[0].exercises[0].sets[0].weight = 999;
  result.workouts[1].exercises[0].sets[0].weight = 888;
  result.routines[3].exercises[0].sets[0].weight = 777;
  assert.deepEqual(cloud, originalCloud);
  assert.deepEqual(legacy, originalLegacy);
});

test("valid legacy storage returns a parsed copy and the unchanged raw text", () => {
  const data = dataWithWorkout();
  const raw = JSON.stringify(data, null, 2);
  withStorage((key) => key === STORAGE_KEY ? raw : null, () => {
    assert.deepEqual(legacyStorageStatus("user-a"), { data, raw, error: null });
  });
});

test("import markers apply only to the matching user and exact imported snapshot", () => {
  const raw = JSON.stringify(dataWithWorkout());
  const values = new Map([
    [STORAGE_KEY, raw],
    ["gym-log:imported:user-a", raw],
    ["gym-log:imported:user-c", JSON.stringify(INITIAL_DATA)],
  ]);
  withStorage((key) => values.get(key) ?? null, () => {
    assert.deepEqual(legacyStorageStatus("user-a"), { data: null, raw: null, error: null });
    assert.equal(legacyStorageStatus("user-b").raw, raw);
    assert.equal(legacyStorageStatus("user-c").raw, raw);
  });
});

test("malformed legacy JSON and unsupported formats retain the original for recovery", () => {
  for (const raw of ["{broken", '{"version":2,"workouts":[],"routines":[]}']) {
    withStorage((key) => key === STORAGE_KEY ? raw : null, () => {
      const status = legacyStorageStatus("user-a");
      assert.equal(status.data, null);
      assert.equal(status.raw, raw);
      assert.match(status.error ?? "", /이전 브라우저 기록을 읽지 못했어요/);
    });
  }
});

test("missing or inaccessible browser storage does not block cloud access", () => {
  for (const getItem of [
    () => null,
    () => { throw new DOMException("Storage blocked", "SecurityError"); },
  ]) {
    withStorage(getItem, () => {
      assert.deepEqual(legacyStorageStatus("user-a"), { data: null, raw: null, error: null });
    });
  }
});
