import { useId, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import {
  EXERCISE_LIBRARY,
  MUSCLE_GROUPS,
  cloneExercises,
  localDate,
  uid,
} from "../lib/gym";
import type {
  MuscleGroup,
  Routine,
  Workout,
  WorkoutExercise,
} from "../lib/gym";
import Icon from "./Icon";

type DraftSet = { id: string; weight: string; reps: string };
type DraftExercise = Omit<WorkoutExercise, "sets"> & { sets: DraftSet[] };

type WorkoutEditorProps = {
  mode: "workout" | "routine";
  initial?: Workout | Routine;
  isEditing?: boolean;
  busy?: boolean;
  routines: Routine[];
  onSave: (value: Workout | Routine) => void;
  onCancel: () => void;
};

function toDraft(exercises: WorkoutExercise[]): DraftExercise[] {
  return exercises.map((exercise) => ({
    ...exercise,
    sets: exercise.sets.map((set) => ({
      id: set.id,
      weight: String(set.weight),
      reps: String(set.reps),
    })),
  }));
}

export default function WorkoutEditor({
  mode,
  initial,
  isEditing = false,
  busy = false,
  routines,
  onSave,
  onCancel,
}: WorkoutEditorProps) {
  const formId = useId();
  const initialWorkout = initial && "date" in initial ? initial : undefined;
  const [name, setName] = useState(initial?.name ?? "");
  const [date, setDate] = useState(initialWorkout?.date ?? localDate());
  const [duration, setDuration] = useState(
    String(initialWorkout?.duration ?? 0),
  );
  const [notes, setNotes] = useState(initialWorkout?.notes ?? "");
  const [description, setDescription] = useState(
    initial && "description" in initial ? initial.description : "",
  );
  const [exercises, setExercises] = useState<DraftExercise[]>(() =>
    toDraft(initial?.exercises ?? []),
  );
  const [routineId, setRoutineId] = useState(() =>
    !isEditing && initial
      ? (routines.find((routine) => routine.name === initial.name)?.id ?? "")
      : "",
  );
  const [pickerOpen, setPickerOpen] = useState(!initial?.exercises.length);
  const [group, setGroup] = useState<MuscleGroup | "전체">("전체");
  const [query, setQuery] = useState("");
  const [customName, setCustomName] = useState("");
  const [customGroup, setCustomGroup] = useState<MuscleGroup>("등");
  const [error, setError] = useState("");
  const [selectionFeedback, setSelectionFeedback] = useState("");

  const filteredExercises = EXERCISE_LIBRARY.filter(
    (exercise) =>
      (group === "전체" || exercise.group === group) &&
      exercise.name
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()),
  );
  const totalSets = exercises.reduce(
    (total, exercise) => total + exercise.sets.length,
    0,
  );

  function applyRoutine(id: string) {
    setRoutineId(id);
    const routine = routines.find((item) => item.id === id);
    if (!routine) return;
    setName(routine.name);
    setExercises(toDraft(cloneExercises(routine.exercises)));
    setSelectionFeedback(
      `${routine.name}의 운동 ${routine.exercises.length}개를 불러왔어요.`,
    );
    setError("");
  }

  function addExercise(exerciseName: string, exerciseGroup: MuscleGroup) {
    const trimmedName = exerciseName.trim();
    if (!trimmedName) {
      setError("추가할 운동 이름을 입력해 주세요.");
      return;
    }
    setExercises((current) => [
      ...current,
      {
        id: uid(),
        name: trimmedName,
        group: exerciseGroup,
        sets: Array.from({ length: 3 }, () => ({
          id: uid(),
          weight: "0",
          reps: "10",
        })),
      },
    ]);
    setSelectionFeedback(
      `${trimmedName} 3세트를 추가했어요 (총 ${exercises.length + 1}개 운동).`,
    );
    setError("");
  }

  function addCustomExercise() {
    if (!customName.trim()) {
      setError("직접 추가할 운동 이름을 입력해 주세요.");
      return;
    }
    addExercise(customName, customGroup);
    setCustomName("");
  }

  function updateSet(
    exerciseId: string,
    setId: string,
    field: "weight" | "reps",
    value: string,
  ) {
    setExercises((current) =>
      current.map((exercise) =>
        exercise.id === exerciseId
          ? {
              ...exercise,
              sets: exercise.sets.map((set) =>
                set.id === setId ? { ...set, [field]: value } : set,
              ),
            }
          : exercise,
      ),
    );
  }

  function addSet(exerciseId: string) {
    setExercises((current) =>
      current.map((exercise) => {
        if (exercise.id !== exerciseId) return exercise;
        const last = exercise.sets.at(-1);
        return {
          ...exercise,
          sets: [
            ...exercise.sets,
            {
              id: uid(),
              weight: last?.weight ?? "0",
              reps: last?.reps ?? "10",
            },
          ],
        };
      }),
    );
  }

  function removeSet(exerciseId: string, setId: string) {
    setExercises((current) =>
      current.map((exercise) =>
        exercise.id === exerciseId && exercise.sets.length > 1
          ? {
              ...exercise,
              sets: exercise.sets.filter((set) => set.id !== setId),
            }
          : exercise,
      ),
    );
  }

  function preventEnter(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") event.preventDefault();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!name.trim()) {
      setError(
        mode === "workout"
          ? "운동 기록 이름을 입력해 주세요."
          : "루틴 이름을 입력해 주세요.",
      );
      return;
    }
    if (exercises.length === 0) {
      setError("운동을 하나 이상 추가해 주세요.");
      return;
    }

    const validExercises = exercises.every(
      (exercise) =>
        exercise.name.trim() &&
        exercise.sets.length > 0 &&
        exercise.sets.every((set) => {
          const weight = Number(set.weight);
          const reps = Number(set.reps);
          return (
            set.weight.trim() !== "" &&
            set.reps.trim() !== "" &&
            Number.isFinite(weight) &&
            weight >= 0 &&
            weight <= 2000 &&
            Number.isInteger(reps) &&
            reps >= 1 &&
            reps <= 1000
          );
        }),
    );
    if (!validExercises) {
      setError(
        "각 운동에 세트를 추가하고 무게(0~2,000kg)와 횟수(1~1,000회)를 확인해 주세요.",
      );
      return;
    }

    const savedExercises: WorkoutExercise[] = exercises.map((exercise) => ({
      ...exercise,
      name: exercise.name.trim(),
      sets: exercise.sets.map((set) => ({
        id: set.id,
        weight: Number(set.weight),
        reps: Number(set.reps),
      })),
    }));
    const shared = {
      id: initial?.id ?? uid(),
      name: name.trim(),
      exercises: savedExercises,
      createdAt: initial?.createdAt ?? new Date().toISOString(),
    };

    if (mode === "routine") {
      onSave({ ...shared, description: description.trim() });
      return;
    }
    const minutes = Number(duration);
    const parsedDate = new Date(`${date}T12:00:00Z`);
    const validDate =
      /^\d{4}-\d{2}-\d{2}$/.test(date) &&
      !Number.isNaN(parsedDate.getTime()) &&
      parsedDate.toISOString().slice(0, 10) === date;
    if (!validDate || date > localDate()) {
      setError("오늘 또는 이전 날짜로 운동을 기록해 주세요.");
      return;
    }
    if (
      duration.trim() === "" ||
      !Number.isInteger(minutes) ||
      minutes < 0 ||
      minutes > 1440
    ) {
      setError("운동 날짜와 운동 시간(0~1,440분)을 확인해 주세요.");
      return;
    }
    onSave({ ...shared, date, duration: minutes, notes: notes.trim() });
  }

  return (
    <form className="editor-form" onSubmit={handleSubmit} aria-busy={busy}>
      <fieldset className="editor-fields" disabled={busy}>
        {mode === "workout" && !isEditing && routines.length > 0 && (
          <div className="form-field">
            <label className="field-label" htmlFor={`${formId}-routine`}>
              루틴 불러오기
            </label>
            <select
              className="input"
              id={`${formId}-routine`}
              value={routineId}
              onChange={(event) => applyRoutine(event.target.value)}
            >
              <option value="">루틴 선택 (선택사항)</option>
              {routines.map((routine) => (
                <option key={routine.id} value={routine.id}>
                  {routine.name} · {routine.exercises.length}개 운동
                </option>
              ))}
            </select>
            <span className="muted">
              루틴을 선택하면 아래 운동 구성이 바뀝니다. 무게와 횟수는 자유롭게
              수정하세요.
            </span>
          </div>
        )}

        <div className="form-field">
          <label className="field-label" htmlFor={`${formId}-name`}>
            {mode === "workout" ? "운동 기록 이름" : "루틴 이름"}
          </label>
          <input
            className="input"
            id={`${formId}-name`}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={
              mode === "workout" ? "예: 오늘의 등 · 이두 운동" : "예: 등 루틴 1"
            }
            maxLength={80}
            required
            autoFocus
          />
        </div>

        {mode === "workout" ? (
          <>
            <div className="form-row">
              <div className="form-field">
                <label className="field-label" htmlFor={`${formId}-date`}>
                  운동 날짜
                </label>
                <input
                  className="input"
                  id={`${formId}-date`}
                  type="date"
                  min="0001-01-01"
                  max={localDate()}
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                  required
                />
              </div>
              <div className="form-field">
                <label className="field-label" htmlFor={`${formId}-duration`}>
                  운동 시간 (분)
                </label>
                <input
                  className="input"
                  id={`${formId}-duration`}
                  aria-describedby={`${formId}-duration-help`}
                  type="number"
                  inputMode="numeric"
                  min="0"
                  max="1440"
                  step="1"
                  value={duration}
                  onChange={(event) => setDuration(event.target.value)}
                  required
                />
                <span className="muted" id={`${formId}-duration-help`}>
                  모르면 0분으로 남겨도 좋아요.
                </span>
              </div>
            </div>
          </>
        ) : (
          <div className="form-field">
            <label className="field-label" htmlFor={`${formId}-description`}>
              루틴 설명 <span className="muted">선택</span>
            </label>
            <textarea
              className="input textarea"
              id={`${formId}-description`}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={300}
              rows={2}
              placeholder="예: 등 너비에 집중하는 날, 이두 운동으로 마무리"
            />
          </div>
        )}

        <details
          className="editor-section exercise-picker-details"
          open={pickerOpen}
          onToggle={(event) => setPickerOpen(event.currentTarget.open)}
          aria-labelledby={`${formId}-add-heading`}
        >
          <summary className="section-heading">
            <h3 id={`${formId}-add-heading`}>운동 추가</h3>
            <span className="picker-summary">
              <span className="muted">종목 선택 · 직접 추가</span>
              <Icon name="chevronDown" size={17} />
            </span>
          </summary>
          <div className="exercise-picker">
            <div className="chips" aria-label="운동 부위 필터">
              {(["전체", ...MUSCLE_GROUPS] as const).map((item) => (
                <button
                  className={`chip ${group === item ? "chip-active" : ""}`}
                  type="button"
                  key={item}
                  aria-pressed={group === item}
                  onClick={() => {
                    setGroup(item);
                    if (item !== "전체") setCustomGroup(item);
                  }}
                >
                  {item}
                </button>
              ))}
            </div>
            <input
              className="input"
              type="search"
              aria-label="운동 이름 검색"
              placeholder="운동 이름 검색"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={preventEnter}
              maxLength={100}
            />
            <div className="exercise-options">
              {filteredExercises.map((exercise) => (
                <button
                  className="exercise-option"
                  type="button"
                  key={`${exercise.group}-${exercise.name}`}
                  onClick={() => addExercise(exercise.name, exercise.group)}
                  aria-label={`${exercise.name} 추가`}
                >
                  <span>
                    {exercise.name}
                    <span className="exercise-meta">{exercise.group}</span>
                  </span>
                  <Icon name="plus" size={16} />
                </button>
              ))}
              {filteredExercises.length === 0 && (
                <p className="muted">
                  검색 결과가 없어요. 아래에서 직접 추가해 보세요.
                </p>
              )}
            </div>
            <p
              className="muted exercise-selection-feedback"
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              {selectionFeedback ||
                "운동을 선택하면 아래 운동 구성에 추가됩니다."}
            </p>
            <div className="custom-exercise">
              <select
                className="input"
                aria-label="직접 추가할 운동 부위"
                value={customGroup}
                onChange={(event) =>
                  setCustomGroup(event.target.value as MuscleGroup)
                }
              >
                {MUSCLE_GROUPS.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
              <input
                className="input"
                aria-label="직접 추가할 운동 이름"
                placeholder="나만의 운동 이름"
                maxLength={100}
                value={customName}
                onChange={(event) => setCustomName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    addCustomExercise();
                  }
                }}
              />
              <button
                className="button button-secondary"
                type="button"
                onClick={addCustomExercise}
              >
                <Icon name="plus" size={16} />
                직접 추가
              </button>
            </div>
          </div>
        </details>

        <section
          className="editor-section"
          aria-labelledby={`${formId}-exercises-heading`}
        >
          <div className="section-heading">
            <h3 id={`${formId}-exercises-heading`}>운동 구성</h3>
            <span className="muted">
              {exercises.length}개 운동 · {totalSets}세트
            </span>
          </div>
          {exercises.length === 0 && (
            <p className="muted">위에서 첫 번째 운동을 추가해 주세요.</p>
          )}
          {exercises.map((exercise, exerciseIndex) => (
            <article
              className="exercise-card"
              key={exercise.id}
              aria-label={`${exerciseIndex + 1}번째 운동 ${exercise.name}`}
            >
              <div className="exercise-card-header">
                <div>
                  <span className={`group-tag group-${exercise.group}`}>
                    {exercise.group}
                  </span>
                  <h4>{exercise.name}</h4>
                </div>
                <button
                  className="icon-button button-ghost"
                  type="button"
                  aria-label={`${exercise.name} 운동 삭제`}
                  onClick={() =>
                    setExercises((current) =>
                      current.filter((item) => item.id !== exercise.id),
                    )
                  }
                >
                  <Icon name="trash" size={17} />
                </button>
              </div>
              <div className="set-table">
                <div className="set-header" aria-hidden="true">
                  <span>세트</span>
                  <span>무게 (kg)</span>
                  <span>횟수</span>
                  <span />
                </div>
                {exercise.sets.map((set, setIndex) => (
                  <div className="set-row" key={set.id}>
                    <span className="set-index">{setIndex + 1}</span>
                    <input
                      className="input set-input"
                      type="number"
                      inputMode="decimal"
                      aria-label={`${exercise.name} ${setIndex + 1}세트 무게 (kg)`}
                      min="0"
                      max="2000"
                      step="any"
                      value={set.weight}
                      onChange={(event) =>
                        updateSet(
                          exercise.id,
                          set.id,
                          "weight",
                          event.target.value,
                        )
                      }
                      required
                    />
                    <input
                      className="input set-input"
                      type="number"
                      inputMode="numeric"
                      aria-label={`${exercise.name} ${setIndex + 1}세트 횟수`}
                      min="1"
                      max="1000"
                      step="1"
                      value={set.reps}
                      onChange={(event) =>
                        updateSet(
                          exercise.id,
                          set.id,
                          "reps",
                          event.target.value,
                        )
                      }
                      required
                    />
                    <button
                      className="icon-button button-ghost"
                      type="button"
                      aria-label={`${exercise.name} ${setIndex + 1}세트 삭제`}
                      disabled={exercise.sets.length === 1}
                      title={
                        exercise.sets.length === 1
                          ? "운동마다 최소 1세트가 필요해요"
                          : "세트 삭제"
                      }
                      onClick={() => removeSet(exercise.id, set.id)}
                    >
                      <Icon name="x" size={16} />
                    </button>
                  </div>
                ))}
              </div>
              <button
                className="button button-ghost add-set"
                type="button"
                onClick={() => addSet(exercise.id)}
                aria-label={`${exercise.name} 세트 추가`}
              >
                <Icon name="plus" size={16} />
                세트 추가
              </button>
            </article>
          ))}
          {exercises.length > 0 && (
            <p className="muted">맨몸 운동은 무게를 0kg으로 기록하세요.</p>
          )}
        </section>

        {mode === "workout" && (
          <div className="form-field">
            <label className="field-label" htmlFor={`${formId}-notes`}>
              운동 메모 <span className="muted">선택</span>
            </label>
            <textarea
              className="input textarea"
              id={`${formId}-notes`}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              maxLength={1000}
              rows={2}
              placeholder="오늘의 컨디션이나 기억하고 싶은 점을 남겨보세요."
            />
          </div>
        )}

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="editor-footer">
          <button
            className="button button-secondary"
            type="button"
            onClick={onCancel}
          >
            취소
          </button>
          <button className="button button-primary" type="submit">
            <Icon name="check" size={17} />
            {busy
              ? "저장 중…"
              : mode === "routine"
                ? "루틴 저장"
                : "운동 기록 저장"}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
