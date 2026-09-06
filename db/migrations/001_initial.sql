-- Gym Log: initial private database schema.
-- App IDs are text and child IDs are unique only within their parent.
-- Array order is stored as a zero-based position.
-- Write a workout/routine and its children in one transaction. The API must
-- retain the app's validation that every parent has an exercise and every
-- exercise has a set. Browser code must never receive database credentials.

BEGIN;

CREATE TABLE public.workouts (
    id text PRIMARY KEY CHECK (char_length(id) BETWEEN 1 AND 200 AND btrim(id) <> ''),
    name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160 AND btrim(name) <> ''),
    workout_date date NOT NULL CHECK (workout_date BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),
    duration_minutes numeric NOT NULL DEFAULT 0 CHECK (duration_minutes BETWEEN 0 AND 1440),
    notes text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 10000),
    created_at timestamptz NOT NULL DEFAULT now() CHECK (isfinite(created_at))
);

CREATE INDEX workouts_date_idx ON public.workouts (workout_date DESC, created_at DESC);

CREATE TABLE public.workout_exercises (
    workout_id text NOT NULL REFERENCES public.workouts (id) ON DELETE CASCADE,
    id text NOT NULL CHECK (char_length(id) BETWEEN 1 AND 200 AND btrim(id) <> ''),
    name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160 AND btrim(name) <> ''),
    muscle_group text NOT NULL CHECK (muscle_group IN ('등', '이두', '가슴', '삼두', '어깨', '하체')),
    position integer NOT NULL CHECK (position >= 0),
    PRIMARY KEY (workout_id, id),
    UNIQUE (workout_id, position) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE public.workout_sets (
    workout_id text NOT NULL,
    exercise_id text NOT NULL,
    id text NOT NULL CHECK (char_length(id) BETWEEN 1 AND 200 AND btrim(id) <> ''),
    position integer NOT NULL CHECK (position >= 0),
    weight_kg numeric NOT NULL CHECK (weight_kg BETWEEN 0 AND 2000),
    reps integer NOT NULL CHECK (reps BETWEEN 1 AND 1000),
    PRIMARY KEY (workout_id, exercise_id, id),
    FOREIGN KEY (workout_id, exercise_id)
        REFERENCES public.workout_exercises (workout_id, id) ON DELETE CASCADE,
    UNIQUE (workout_id, exercise_id, position) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE public.routines (
    id text PRIMARY KEY CHECK (char_length(id) BETWEEN 1 AND 200 AND btrim(id) <> ''),
    name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160 AND btrim(name) <> ''),
    description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 10000),
    created_at timestamptz NOT NULL DEFAULT now() CHECK (isfinite(created_at))
);

CREATE TABLE public.routine_exercises (
    routine_id text NOT NULL REFERENCES public.routines (id) ON DELETE CASCADE,
    id text NOT NULL CHECK (char_length(id) BETWEEN 1 AND 200 AND btrim(id) <> ''),
    name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160 AND btrim(name) <> ''),
    muscle_group text NOT NULL CHECK (muscle_group IN ('등', '이두', '가슴', '삼두', '어깨', '하체')),
    position integer NOT NULL CHECK (position >= 0),
    PRIMARY KEY (routine_id, id),
    UNIQUE (routine_id, position) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE public.routine_sets (
    routine_id text NOT NULL,
    exercise_id text NOT NULL,
    id text NOT NULL CHECK (char_length(id) BETWEEN 1 AND 200 AND btrim(id) <> ''),
    position integer NOT NULL CHECK (position >= 0),
    weight_kg numeric NOT NULL CHECK (weight_kg BETWEEN 0 AND 2000),
    reps integer NOT NULL CHECK (reps BETWEEN 1 AND 1000),
    PRIMARY KEY (routine_id, exercise_id, id),
    FOREIGN KEY (routine_id, exercise_id)
        REFERENCES public.routine_exercises (routine_id, id) ON DELETE CASCADE,
    UNIQUE (routine_id, exercise_id, position) DEFERRABLE INITIALLY DEFERRED
);

COMMIT;
