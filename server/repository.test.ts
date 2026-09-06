import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import pg from "pg";
import type { Pool } from "pg";
import { INITIAL_DATA } from "../src/lib/gym.ts";
import type { GymData } from "../src/lib/gym.ts";
import { ConflictError, GymRepository, ValidationError } from "./repository.ts";

interface QueryCall {
  sql: string;
  parameters: unknown[];
}

function fakeDatabase(
  handle: (call: QueryCall) => Record<string, unknown>[] | undefined = () =>
    undefined,
) {
  const queries: QueryCall[] = [];
  const releases: (Error | undefined)[] = [];
  let connections = 0;
  const client = {
    async query(sql: string, parameters: unknown[] = []) {
      const call = { sql, parameters };
      queries.push(call);
      const rows = handle(call);
      if (rows) return { rows };
      if (sql.startsWith("SELECT revision")) return { rows: [{ revision: 0 }] };
      if (sql.startsWith("UPDATE public.user_workspaces")) {
        return { rows: [{ revision: 1 }] };
      }
      return { rows: [] };
    },
    release(error?: Error) {
      releases.push(error);
    },
  };
  const pool = {
    async connect() {
      connections += 1;
      return client;
    },
  } as unknown as Pool;
  return {
    repository: new GymRepository(pool),
    queries,
    releases,
    get connections() {
      return connections;
    },
  };
}

test("invalid snapshots and revisions are rejected before a database connection opens", async () => {
  const db = fakeDatabase();
  for (const revision of [-1, 0.5, "0", null, NaN, Infinity]) {
    await assert.rejects(
      db.repository.saveData("user-a", INITIAL_DATA, revision),
      ValidationError,
    );
  }
  await assert.rejects(
    db.repository.saveData("user-a", {}, 0),
    ValidationError,
  );
  await assert.rejects(db.repository.getData(" "), ValidationError);
  assert.equal(db.connections, 0);
});

test("a stale revision rolls back without deleting or replacing any records", async () => {
  const db = fakeDatabase(({ sql }) =>
    sql.startsWith("SELECT revision") ? [{ revision: 4 }] : undefined,
  );
  await assert.rejects(
    db.repository.saveData("user-a", INITIAL_DATA, 3),
    ConflictError,
  );
  assert.equal(db.queries[0].sql, "BEGIN");
  assert.equal(db.queries.at(-1)?.sql, "ROLLBACK");
  assert.equal(
    db.queries.some(({ sql }) => sql.startsWith("DELETE")),
    false,
  );
  assert.equal(
    db.queries.some(({ sql }) => sql.startsWith("UPDATE")),
    false,
  );
  assert.deepEqual(db.releases, [undefined]);
});

test("a failed child insert rolls back the entire replacement and releases the connection", async () => {
  const failure = new Error("simulated connection failure during child insert");
  const db = fakeDatabase(({ sql }) => {
    if (sql.startsWith("INSERT INTO public.routine_sets")) throw failure;
    return undefined;
  });
  await assert.rejects(
    db.repository.saveData("user-a", INITIAL_DATA, 0),
    (error) => error === failure,
  );
  assert.equal(db.queries.at(-1)?.sql, "ROLLBACK");
  assert.equal(
    db.queries.some(({ sql }) => sql === "COMMIT"),
    false,
  );
  assert.equal(
    db.queries.some(({ sql }) => sql.startsWith("UPDATE")),
    false,
  );
  assert.deepEqual(db.releases, [undefined]);
});

test("a failed rollback discards the damaged connection and preserves the original error", async () => {
  const failure = new Error("simulated write failure");
  const rollbackFailure = new Error("simulated rollback failure");
  const db = fakeDatabase(({ sql }) => {
    if (sql.startsWith("DELETE")) throw failure;
    if (sql === "ROLLBACK") throw rollbackFailure;
    return undefined;
  });
  await assert.rejects(
    db.repository.saveData("user-a", INITIAL_DATA, 0),
    (error) => error === failure,
  );
  assert.deepEqual(db.releases, [rollbackFailure]);
});

test("workspace initialization seeds only its first creation and holds the lock through reads", async () => {
  let created = false;
  const db = fakeDatabase(({ sql }) => {
    if (sql.startsWith("INSERT INTO public.user_workspaces")) {
      if (created) return [];
      created = true;
      return [{ user_id: "user-a" }];
    }
    return undefined;
  });
  await db.repository.getData("user-a");
  const seed = db.queries.find(({ sql }) =>
    sql.startsWith("INSERT INTO public.routines"),
  );
  assert.ok(seed);
  assert.equal(JSON.parse(seed.parameters[1] as string).length, 3);
  const lockIndex = db.queries.findIndex(({ sql }) =>
    sql.includes("FOR UPDATE"),
  );
  const seedIndex = db.queries.indexOf(seed);
  assert.ok(lockIndex > 0 && lockIndex < seedIndex);
  assert.equal(db.queries.at(-1)?.sql, "COMMIT");
  const firstLength = db.queries.length;
  await db.repository.getData("user-a");
  assert.equal(
    db.queries.slice(firstLength).some(({ sql }) => sql.startsWith("DELETE")),
    false,
  );
  assert.deepEqual(db.releases, [undefined, undefined]);
});

test("client IDs remain parameters, parent IDs are scoped per user, and all deletion is scoped", async () => {
  const data = structuredClone(INITIAL_DATA);
  data.routines[0].id = "client-id'; DELETE FROM public.workouts; --";
  const db = fakeDatabase();
  for (const user of ["user-a", "user-b"]) {
    await db.repository.saveData(user, data, 0);
  }
  assert.equal(
    db.queries.some(({ sql }) => sql.includes(data.routines[0].id)),
    false,
  );
  const inserts = db.queries.filter(({ sql }) =>
    sql.startsWith("INSERT INTO public.routines"),
  );
  const a = JSON.parse(inserts[0].parameters[1] as string);
  const b = JSON.parse(inserts[1].parameters[1] as string);
  assert.equal(a[0].client_id, data.routines[0].id);
  assert.match(a[0].id, /^[a-f0-9]{64}$/);
  assert.notEqual(a[0].id, b[0].id);
  assert.deepEqual(
    a.map((row: { position: number }) => row.position),
    [0, 1, 2],
  );
  for (const query of db.queries.filter(({ sql }) =>
    sql.startsWith("DELETE"),
  )) {
    assert.match(query.sql, /WHERE owner_id = \$1$/);
    assert.equal(query.parameters.length, 1);
    assert.ok(["user-a", "user-b"].includes(query.parameters[0] as string));
  }
  for (const query of db.queries.filter(({ sql }) =>
    sql.trimStart().startsWith("SELECT"),
  )) {
    assert.ok(
      query.sql.includes("owner_id = $1") || query.sql.includes("user_id = $1"),
    );
  }
});

test("database numerics, dates, nested IDs and timestamps return in the app format", async () => {
  const db = fakeDatabase(({ sql }) => {
    if (sql.includes("FROM public.workouts WHERE")) {
      return [
        {
          id: "internal-workout-id",
          client_id: "visible-workout-id",
          name: "운동",
          date: "2024-02-29",
          duration_minutes: "45.5",
          notes: "메모",
          created_at: new Date("2026-09-05T03:00:00Z"),
        },
      ];
    }
    if (sql.includes("FROM public.workout_exercises AS exercise")) {
      return [
        {
          parent_id: "internal-workout-id",
          id: "exercise",
          name: "랫풀다운",
          muscle_group: "등",
        },
      ];
    }
    if (sql.includes("FROM public.workout_sets AS exercise_set")) {
      return [
        {
          parent_id: "internal-workout-id",
          exercise_id: "exercise",
          id: "set",
          weight_kg: "42.5",
          reps: 12,
        },
      ];
    }
    return undefined;
  });
  assert.deepEqual(await db.repository.getData("user-a"), {
    revision: 0,
    data: {
      version: 1,
      routines: [],
      workouts: [
        {
          id: "visible-workout-id",
          name: "운동",
          date: "2024-02-29",
          duration: 45.5,
          notes: "메모",
          createdAt: "2026-09-05T03:00:00.000Z",
          exercises: [
            {
              id: "exercise",
              name: "랫풀다운",
              group: "등",
              sets: [{ id: "set", weight: 42.5, reps: 12 }],
            },
          ],
        },
      ],
    },
  });
});

// Opt-in real PostgreSQL check. Run against a migrated test database. It creates
// only randomly named test workspaces and removes exactly those in its finally.
test(
  "Postgres round-trip, cross-user isolation, empty state, rollback and concurrent saves",
  {
    skip: !process.env.TEST_DATABASE_URL,
  },
  async () => {
    const pool = new pg.Pool({
      connectionString: process.env.TEST_DATABASE_URL,
      max: 4,
    });
    const repository = new GymRepository(pool);
    const users = [
      `repository-test-a-${randomUUID()}`,
      `repository-test-b-${randomUUID()}`,
    ];
    try {
      const first = await repository.getData(users[0]);
      const second = await repository.getData(users[1]);
      assert.deepEqual(first, { data: INITIAL_DATA, revision: 0 });
      assert.deepEqual(second, first);

      const data: GymData = structuredClone(INITIAL_DATA);
      data.routines.reverse();
      data.routines[0].id = "same-client-id'\"; --";
      data.routines[0].exercises.reverse();
      data.routines[0].exercises[0].sets.reverse();
      data.routines[0].exercises[0].sets[0].weight = 42.5;
      data.workouts = [
        {
          id: data.routines[0].id,
          name: "운동 💪",
          date: "2024-02-29",
          duration: 45.5,
          notes: "기록\n두 번째 줄",
          createdAt: "2026-09-05T03:00:00.000Z",
          exercises: structuredClone(data.routines[0].exercises),
        },
      ];
      assert.deepEqual(await repository.saveData(users[0], data, 0), {
        data,
        revision: 1,
      });
      assert.deepEqual(await repository.getData(users[0]), {
        data,
        revision: 1,
      });
      assert.deepEqual(await repository.getData(users[1]), second);
      assert.deepEqual(await repository.saveData(users[1], data, 0), {
        data,
        revision: 1,
      });
      await assert.rejects(
        repository.saveData(users[0], INITIAL_DATA, 0),
        ConflictError,
      );
      assert.deepEqual(await repository.getData(users[0]), {
        data,
        revision: 1,
      });

      // Force a PostgreSQL error after deletion: JSONB rejects a NUL in text.
      const rejected = structuredClone(data);
      rejected.workouts[0].notes = "\u0000";
      await assert.rejects(repository.saveData(users[0], rejected, 1));
      assert.deepEqual(await repository.getData(users[0]), {
        data,
        revision: 1,
      });

      const empty: GymData = { version: 1, workouts: [], routines: [] };
      const concurrent = await Promise.allSettled([
        repository.saveData(users[0], empty, 1),
        repository.saveData(users[0], empty, 1),
      ]);
      assert.equal(
        concurrent.filter((result) => result.status === "fulfilled").length,
        1,
      );
      const loser = concurrent.find((result) => result.status === "rejected");
      assert.ok(
        loser?.status === "rejected" && loser.reason instanceof ConflictError,
      );
      assert.deepEqual(await repository.getData(users[0]), {
        data: empty,
        revision: 2,
      });
      assert.deepEqual(await repository.getData(users[0]), {
        data: empty,
        revision: 2,
      });
      assert.deepEqual(await repository.getData(users[1]), {
        data,
        revision: 1,
      });
    } finally {
      try {
        await pool.query(
          "DELETE FROM public.user_workspaces WHERE user_id = ANY($1::text[])",
          [users],
        );
      } finally {
        await pool.end();
      }
    }
  },
);
