-- Each signed-in user owns a workspace. Client IDs remain unchanged in backups;
-- the API derives separate internal parent IDs to prevent cross-user collisions.
-- These NOT NULL additions intentionally fail if unowned legacy rows exist.
BEGIN;

CREATE TABLE public.user_workspaces (
    user_id text PRIMARY KEY CHECK (btrim(user_id) <> ''),
    revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.workouts
    ADD COLUMN owner_id text NOT NULL REFERENCES public.user_workspaces (user_id) ON DELETE CASCADE,
    ADD COLUMN client_id text NOT NULL CHECK (char_length(client_id) BETWEEN 1 AND 200 AND btrim(client_id) <> ''),
    ADD COLUMN position integer NOT NULL CHECK (position >= 0),
    ADD CONSTRAINT workouts_owner_client_id_key UNIQUE (owner_id, client_id),
    ADD CONSTRAINT workouts_owner_position_key UNIQUE (owner_id, position) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE public.routines
    ADD COLUMN owner_id text NOT NULL REFERENCES public.user_workspaces (user_id) ON DELETE CASCADE,
    ADD COLUMN client_id text NOT NULL CHECK (char_length(client_id) BETWEEN 1 AND 200 AND btrim(client_id) <> ''),
    ADD COLUMN position integer NOT NULL CHECK (position >= 0),
    ADD CONSTRAINT routines_owner_client_id_key UNIQUE (owner_id, client_id),
    ADD CONSTRAINT routines_owner_position_key UNIQUE (owner_id, position) DEFERRABLE INITIALLY DEFERRED;

COMMIT;
