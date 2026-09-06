import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { INITIAL_DATA, validateData } from "../src/lib/gym.ts";
import type {
  GymData,
  MuscleGroup,
  Routine,
  Workout,
  WorkoutExercise,
} from "../src/lib/gym.ts";

export interface DataSnapshot {
  data: GymData;
  revision: number;
}

export class ConflictError extends Error {
  constructor() {
    super(
      "다른 기기에서 기록이 변경됐어요. 최신 기록을 불러온 뒤 다시 저장해 주세요.",
    );
    this.name = "ConflictError";
  }
}

export class ValidationError extends Error {
  constructor() {
    super("저장할 기록의 형식이나 버전이 올바르지 않아요.");
    this.name = "ValidationError";
  }
}

interface ParentRow {
  id: string;
  client_id: string;
  name: string;
  created_at: Date | string;
}

interface WorkoutRow extends ParentRow {
  date: string;
  duration_minutes: string | number;
  notes: string;
}

interface RoutineRow extends ParentRow {
  description: string;
}

interface ExerciseRow {
  parent_id: string;
  id: string;
  name: string;
  muscle_group: MuscleGroup;
}

interface SetRow {
  parent_id: string;
  exercise_id: string;
  id: string;
  weight_kg: string | number;
  reps: number;
}

function internalId(userId: string, clientId: string): string {
  return createHash("sha256")
    .update(JSON.stringify([userId, clientId]))
    .digest("hex");
}

function canonicalTimestamp(value: Date | string): string {
  return new Date(value).toISOString();
}

/** A workspace row lock covers every read and write in one user's snapshot. */
export class GymRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async getData(userId: string): Promise<DataSnapshot> {
    return this.withWorkspace(userId, async (client, revision) => ({
      data: await this.readData(client, userId),
      revision,
    }));
  }

  async saveData(
    userId: string,
    data: unknown,
    expectedRevision: unknown,
  ): Promise<DataSnapshot> {
    if (
      !Number.isInteger(expectedRevision) ||
      typeof expectedRevision !== "number" ||
      expectedRevision < 0 ||
      expectedRevision > 2_147_483_646 ||
      !validateData(data)
    ) {
      throw new ValidationError();
    }
    // Freeze the validated snapshot before any asynchronous database work.
    const snapshot = structuredClone(data);
    return this.withWorkspace(userId, async (client, revision) => {
      if (revision !== expectedRevision) throw new ConflictError();
      await this.replaceData(client, userId, snapshot);
      const result = await client.query<{ revision: number }>(
        `UPDATE public.user_workspaces
         SET revision = revision + 1, updated_at = now()
         WHERE user_id = $1 RETURNING revision`,
        [userId],
      );
      return {
        data: await this.readData(client, userId),
        revision: result.rows[0].revision,
      };
    });
  }

  private async withWorkspace<T>(
    userId: string,
    action: (client: PoolClient, revision: number) => Promise<T>,
  ): Promise<T> {
    if (typeof userId !== "string" || !userId.trim()) {
      throw new ValidationError();
    }
    const client = await this.pool.connect();
    let rollbackError: Error | undefined;
    try {
      await client.query("BEGIN");
      const inserted = await client.query<{ user_id: string }>(
        `INSERT INTO public.user_workspaces (user_id) VALUES ($1)
         ON CONFLICT (user_id) DO NOTHING RETURNING user_id`,
        [userId],
      );
      const workspace = await client.query<{ revision: number }>(
        `SELECT revision FROM public.user_workspaces
         WHERE user_id = $1 FOR UPDATE`,
        [userId],
      );
      if (!workspace.rows[0]) throw new Error("Workspace is unavailable");
      if (inserted.rows.length > 0) {
        await this.replaceData(client, userId, INITIAL_DATA);
      }
      const result = await action(client, workspace.rows[0].revision);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch (failure) {
        rollbackError =
          failure instanceof Error ? failure : new Error("Rollback failed");
      }
      throw error;
    } finally {
      // A connection whose rollback failed must not return to the idle pool.
      client.release(rollbackError);
    }
  }

  private async replaceData(
    client: PoolClient,
    userId: string,
    data: GymData,
  ): Promise<void> {
    await client.query("DELETE FROM public.workouts WHERE owner_id = $1", [
      userId,
    ]);
    await client.query("DELETE FROM public.routines WHERE owner_id = $1", [
      userId,
    ]);

    const workouts = data.workouts.map((workout, position) => ({
      id: internalId(userId, workout.id),
      client_id: workout.id,
      position,
      name: workout.name,
      workout_date: workout.date,
      duration_minutes: workout.duration,
      notes: workout.notes,
      created_at: workout.createdAt,
    }));
    const routines = data.routines.map((routine, position) => ({
      id: internalId(userId, routine.id),
      client_id: routine.id,
      position,
      name: routine.name,
      description: routine.description,
      created_at: routine.createdAt,
    }));
    await client.query(
      `INSERT INTO public.workouts
         (id, owner_id, client_id, position, name, workout_date, duration_minutes, notes, created_at)
       SELECT id, $1, client_id, position, name, workout_date, duration_minutes, notes, created_at
       FROM jsonb_to_recordset($2::jsonb) AS item(
         id text, client_id text, position integer, name text, workout_date date,
         duration_minutes numeric, notes text, created_at timestamptz)`,
      [userId, JSON.stringify(workouts)],
    );
    await client.query(
      `INSERT INTO public.routines
         (id, owner_id, client_id, position, name, description, created_at)
       SELECT id, $1, client_id, position, name, description, created_at
       FROM jsonb_to_recordset($2::jsonb) AS item(
         id text, client_id text, position integer, name text,
         description text, created_at timestamptz)`,
      [userId, JSON.stringify(routines)],
    );
    await this.insertExercises(client, userId, "workout", data.workouts);
    await this.insertExercises(client, userId, "routine", data.routines);
  }

  private async insertExercises(
    client: PoolClient,
    userId: string,
    kind: "workout" | "routine",
    parents: (Workout | Routine)[],
  ): Promise<void> {
    const exercises = parents.flatMap((parent) =>
      parent.exercises.map((exercise, position) => ({
        parent_id: internalId(userId, parent.id),
        id: exercise.id,
        position,
        name: exercise.name,
        muscle_group: exercise.group,
      })),
    );
    const sets = parents.flatMap((parent) =>
      parent.exercises.flatMap((exercise) =>
        exercise.sets.map((set, position) => ({
          parent_id: internalId(userId, parent.id),
          exercise_id: exercise.id,
          id: set.id,
          position,
          weight_kg: set.weight,
          reps: set.reps,
        })),
      ),
    );
    // Only the fixed, internal union above selects SQL identifiers. Every client
    // ID, exercise name, number, and timestamp is carried in bound parameters.
    await client.query(
      `INSERT INTO public.${kind}_exercises
         (${kind}_id, id, position, name, muscle_group)
       SELECT parent_id, id, position, name, muscle_group
       FROM jsonb_to_recordset($1::jsonb) AS item(
         parent_id text, id text, position integer, name text, muscle_group text)`,
      [JSON.stringify(exercises)],
    );
    await client.query(
      `INSERT INTO public.${kind}_sets
         (${kind}_id, exercise_id, id, position, weight_kg, reps)
       SELECT parent_id, exercise_id, id, position, weight_kg, reps
       FROM jsonb_to_recordset($1::jsonb) AS item(
         parent_id text, exercise_id text, id text, position integer,
         weight_kg numeric, reps integer)`,
      [JSON.stringify(sets)],
    );
  }

  private async readData(client: PoolClient, userId: string): Promise<GymData> {
    const workouts = await client.query<WorkoutRow>(
      `SELECT id, client_id, name, to_char(workout_date, 'YYYY-MM-DD') AS date,
              duration_minutes, notes, created_at
       FROM public.workouts WHERE owner_id = $1 ORDER BY position`,
      [userId],
    );
    const routines = await client.query<RoutineRow>(
      `SELECT id, client_id, name, description, created_at
       FROM public.routines WHERE owner_id = $1 ORDER BY position`,
      [userId],
    );
    const workoutExercises = await this.readExercises(
      client,
      userId,
      "workout",
    );
    const routineExercises = await this.readExercises(
      client,
      userId,
      "routine",
    );
    return {
      version: 1,
      workouts: workouts.rows.map((row) => ({
        id: row.client_id,
        name: row.name,
        date: row.date,
        duration: Number(row.duration_minutes),
        notes: row.notes,
        createdAt: canonicalTimestamp(row.created_at),
        exercises: workoutExercises.get(row.id) ?? [],
      })),
      routines: routines.rows.map((row) => ({
        id: row.client_id,
        name: row.name,
        description: row.description,
        createdAt: canonicalTimestamp(row.created_at),
        exercises: routineExercises.get(row.id) ?? [],
      })),
    };
  }

  private async readExercises(
    client: PoolClient,
    userId: string,
    kind: "workout" | "routine",
  ): Promise<Map<string, WorkoutExercise[]>> {
    const exercises = await client.query<ExerciseRow>(
      `SELECT exercise.${kind}_id AS parent_id, exercise.id, exercise.name, exercise.muscle_group
       FROM public.${kind}_exercises AS exercise
       JOIN public.${kind}s AS parent ON parent.id = exercise.${kind}_id
       WHERE parent.owner_id = $1 ORDER BY parent.position, exercise.position`,
      [userId],
    );
    const sets = await client.query<SetRow>(
      `SELECT exercise_set.${kind}_id AS parent_id, exercise_set.exercise_id,
              exercise_set.id, exercise_set.weight_kg, exercise_set.reps
       FROM public.${kind}_sets AS exercise_set
       JOIN public.${kind}_exercises AS exercise
         ON exercise.${kind}_id = exercise_set.${kind}_id
        AND exercise.id = exercise_set.exercise_id
       JOIN public.${kind}s AS parent ON parent.id = exercise_set.${kind}_id
       WHERE parent.owner_id = $1
       ORDER BY parent.position, exercise.position, exercise_set.position`,
      [userId],
    );
    const grouped = new Map<string, WorkoutExercise[]>();
    const byParent = new Map<string, Map<string, WorkoutExercise>>();
    for (const row of exercises.rows) {
      const exercise: WorkoutExercise = {
        id: row.id,
        name: row.name,
        group: row.muscle_group,
        sets: [],
      };
      if (!grouped.has(row.parent_id)) {
        grouped.set(row.parent_id, []);
        byParent.set(row.parent_id, new Map());
      }
      grouped.get(row.parent_id)!.push(exercise);
      byParent.get(row.parent_id)!.set(row.id, exercise);
    }
    for (const row of sets.rows) {
      const exercise = byParent.get(row.parent_id)?.get(row.exercise_id);
      if (!exercise) throw new Error("Stored exercise is unavailable");
      exercise.sets.push({
        id: row.id,
        weight: Number(row.weight_kg),
        reps: Number(row.reps),
      });
    }
    return grouped;
  }
}
