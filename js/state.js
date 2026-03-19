export function createAppState() {
    return {
        currentUser: null,
        currentWorkout: null,
        selectedMuscleGroups: new Set(),
        collapsedWorkoutGroups: new Set(),
        currentChart: null,
        currentWeightChart: null,
        dialogQueue: [],
        isDialogOpen: false,
        currentDialogResolve: null,
        isSavingToServer: false,
        draftDirty: false,
        localAutoSaveTimer: null,
        serverAutoSaveTimer: null,
        inMemoryStorage: {},
        progressMonthCursor: null
    };
}

export function getSelectedTypes(state) {
    return Array.from(state.selectedMuscleGroups);
}

export function setSelectedTypes(state, types) {
    state.selectedMuscleGroups = new Set(types);
}