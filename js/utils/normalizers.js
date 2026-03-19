const LEGACY_TYPE_MAP = {
    Brazo: 'Triceps'
};

export const CARDIO_TYPE = 'Cardio';

function canonicalizeType(type) {
    const normalized = String(type || '').trim();
    if (!normalized) {
        return 'Sin Grupo';
    }

    return LEGACY_TYPE_MAP[normalized] || normalized;
}

export function normalizeNumber(value, parser) {
    if (value === null || value === undefined || value === '') {
        return null;
    }

    const parsed = parser(value);
    return Number.isFinite(parsed) ? parsed : null;
}

export function isCardioType(type) {
    return canonicalizeType(type) === CARDIO_TYPE;
}

export function createEmptySet(type = 'Sin Grupo') {
    return {
        reps: null,
        weight: null,
        durationSeconds: null,
        avgSpeed: null,
        completed: false,
        ...(isCardioType(type) ? {} : {})
    };
}

export function hasSetData(set, exerciseType = 'Sin Grupo') {
    if (isCardioType(exerciseType)) {
        return set?.durationSeconds !== null || set?.avgSpeed !== null;
    }

    return set?.reps !== null || set?.weight !== null;
}

export function formatDurationSeconds(value) {
    if (!Number.isFinite(value) || value === null) {
        return '--:--';
    }

    const totalSeconds = Math.max(0, Math.round(value));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatDecimal(value, maximumFractionDigits = 2) {
    if (!Number.isFinite(value) || value === null) {
        return '-';
    }

    return Number(value).toLocaleString('es-ES', {
        minimumFractionDigits: 0,
        maximumFractionDigits
    });
}

export function normalizeSet(rawSet, exerciseType = 'Sin Grupo') {
    const durationSeconds = normalizeNumber(rawSet?.durationSeconds, (input) => parseInt(input, 10));
    const avgSpeed = normalizeNumber(rawSet?.avgSpeed, (input) => parseFloat(input));

    return {
        reps: isCardioType(exerciseType) ? null : normalizeNumber(rawSet?.reps, (input) => parseInt(input, 10)),
        weight: isCardioType(exerciseType) ? null : normalizeNumber(rawSet?.weight, (input) => parseFloat(input)),
        durationSeconds: isCardioType(exerciseType) ? durationSeconds : null,
        avgSpeed: isCardioType(exerciseType) ? avgSpeed : null,
        completed: Boolean(rawSet?.completed)
    };
}

export function normalizeExercise(rawExercise, fallbackType = 'Sin Grupo') {
    const name = String(rawExercise?.name || '').trim();
    if (!name) {
        return null;
    }

    const type = canonicalizeType(rawExercise?.type || fallbackType || 'Sin Grupo');
    const sets = Array.isArray(rawExercise?.sets) ? rawExercise.sets.map((set) => normalizeSet(set, type)) : [];

    return {
        name,
        type,
        sets,
        collapsed: Boolean(rawExercise?.collapsed)
    };
}

export function deriveWorkoutTypes(exercises, explicitTypes = []) {
    const types = [];

    explicitTypes.forEach((type) => {
        const normalized = canonicalizeType(type);
        if (normalized && normalized !== 'Sin Grupo' && !types.includes(normalized)) {
            types.push(normalized);
        }
    });

    exercises.forEach((exercise) => {
        if (exercise.type && exercise.type !== 'Sin Grupo' && !types.includes(exercise.type)) {
            types.push(exercise.type);
        }
    });

    return types;
}

export function normalizeWorkoutData(rawWorkout) {
    if (!rawWorkout || !rawWorkout.date) {
        return null;
    }

    const explicitTypes = Array.isArray(rawWorkout.types)
        ? rawWorkout.types
        : rawWorkout.type ? [rawWorkout.type] : [];
    const fallbackType = explicitTypes[0] || 'Sin Grupo';
    const exercises = [];
    const seenKeys = new Set();

    (rawWorkout.exercises || []).forEach((exercise) => {
        const normalized = normalizeExercise(exercise, fallbackType);
        if (!normalized) {
            return;
        }

        const key = `${normalized.type}::${normalized.name.toLowerCase()}`;
        if (seenKeys.has(key)) {
            return;
        }

        seenKeys.add(key);
        exercises.push(normalized);
    });

    return {
        date: String(rawWorkout.date),
        id: rawWorkout.id || null,
        exercises,
        types: deriveWorkoutTypes(exercises, explicitTypes)
    };
}

export function buildDraftPayload(currentWorkout, selectedTypes) {
    if (!currentWorkout) {
        return null;
    }

    const normalizedWorkout = normalizeWorkoutData({
        date: currentWorkout.date,
        exercises: currentWorkout.exercises,
        types: selectedTypes,
        id: currentWorkout.id
    });

    if (!normalizedWorkout) {
        return null;
    }

    return {
        date: normalizedWorkout.date,
        exercises: normalizedWorkout.exercises,
        types: normalizedWorkout.types,
        id: normalizedWorkout.id,
        isDraft: true,
        savedAt: new Date().toISOString()
    };
}

export function formatSetTag(set) {
    if (isCardioType(set?.type) || set?.durationSeconds !== null || set?.avgSpeed !== null) {
        const duration = formatDurationSeconds(set?.durationSeconds);
        const speed = formatDecimal(set?.avgSpeed, 2);
        return `${duration} · ${speed} km/h`;
    }

    const reps = set.reps ?? '-';
    const weight = formatDecimal(set.weight, 2);
    return `${reps} x ${weight}kg`;
}

export function formatWorkoutDate(date) {
    if (!date) {
        return '';
    }

    const [year, month, day] = date.split('-');
    const dateObj = new Date(year, month - 1, day);
    const monthName = dateObj.toLocaleString('es-ES', { month: 'short' }).replace('.', '').toUpperCase();
    return `${day} ${monthName}`;
}