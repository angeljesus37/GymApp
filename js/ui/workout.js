import { buildDraftPayload, createEmptySet, deriveWorkoutTypes, formatSetTag, formatWorkoutDate, isCardioType, normalizeExercise, normalizeWorkoutData } from '../utils/normalizers.js';
import { getSelectedTypes, setSelectedTypes } from '../state.js';

export function createWorkoutController({
    elements,
    state,
    api,
    dialogs,
    persistence,
    switchTab,
    showHistory,
    setSaveStatusText
}) {
    function updateSelectedTypesDisplay() {
        elements.workoutTypeDisplay.textContent = state.selectedMuscleGroups.size
            ? getSelectedTypes(state).join(', ')
            : 'Selecciona grupos';
    }

    function updateWorkoutDateDisplay() {
        elements.workoutDateDisplay.textContent = formatWorkoutDate(state.currentWorkout?.date);
    }

    function syncMuscleGroupSelection() {
        Array.from(elements.muscleGroupSelect?.options || []).forEach((option) => {
            option.selected = state.selectedMuscleGroups.has(option.value);
        });
    }

    function getSelectedMuscleGroupsFromControl() {
        return Array.from(elements.muscleGroupSelect?.selectedOptions || [])
            .map((option) => option.value.trim())
            .filter(Boolean);
    }

    function openMuscleGroupPicker() {
        syncMuscleGroupSelection();
        try {
            elements.muscleGroupSelect?.showPicker?.();
        } catch (error) {
            // Some browsers do not expose showPicker on select elements.
        }

        elements.muscleGroupSelect?.focus();
        elements.muscleGroupSelect?.click?.();
    }

    function populateExerciseTypeOptions() {
        const currentValue = elements.exerciseTypeSelect.value;
        const selectedTypes = getSelectedTypes(state);
        const options = [...selectedTypes, 'Sin Grupo'];

        elements.exerciseTypeSelect.innerHTML = '';
        options.forEach((type) => {
            const option = document.createElement('option');
            option.value = type;
            option.textContent = type === 'Sin Grupo' ? 'Sin grupo' : type;
            elements.exerciseTypeSelect.appendChild(option);
        });

        if (selectedTypes.length === 1) {
            elements.exerciseTypeSelect.value = selectedTypes[0];
            return;
        }

        elements.exerciseTypeSelect.value = options.includes(currentValue) ? currentValue : options[0];
    }

    function createEmptyState(message) {
        const emptyState = document.createElement('div');
        emptyState.className = 'empty-state';
        emptyState.innerHTML = `<p>${message}</p>`;
        return emptyState;
    }

    function closeExerciseHistoryModal() {
        elements.exerciseHistoryModal?.classList.add('hidden');
        if (elements.exerciseHistoryContainer) {
            elements.exerciseHistoryContainer.innerHTML = '';
        }
        if (elements.exerciseHistorySubtitle) {
            elements.exerciseHistorySubtitle.textContent = '';
        }
    }

    async function openExerciseHistory(exercise) {
        if (!elements.exerciseHistoryModal || !elements.exerciseHistoryContainer) {
            return;
        }

        elements.exerciseHistoryTitle.textContent = exercise.name;
        elements.exerciseHistorySubtitle.textContent = 'Cargando historial...';
        elements.exerciseHistoryContainer.innerHTML = '<div class="empty-state"><p>Cargando historial...</p></div>';
        elements.exerciseHistoryModal.classList.remove('hidden');

        try {
            const history = await api.getHistory('Todos');
            const normalizedName = exercise.name.trim().toLowerCase();
            const normalizedType = String(exercise.type || '').trim().toLowerCase();
            const matchingSessions = history
                .map((session) => {
                    const matchingExercises = (session.exercises || []).filter((item) => {
                        const sameName = String(item.name || '').trim().toLowerCase() === normalizedName;
                        if (!sameName) {
                            return false;
                        }

                        if (!normalizedType || normalizedType === 'sin grupo') {
                            return true;
                        }

                        return String(item.type || '').trim().toLowerCase() === normalizedType;
                    });

                    return matchingExercises.length ? { ...session, matchingExercises } : null;
                })
                .filter(Boolean);

            elements.exerciseHistorySubtitle.textContent = matchingSessions.length
                ? `${matchingSessions.length} sesiones registradas${exercise.type && exercise.type !== 'Sin Grupo' ? ` · ${exercise.type}` : ''}`
                : 'Sin historial registrado';

            if (!matchingSessions.length) {
                elements.exerciseHistoryContainer.innerHTML = '<div class="empty-state"><p>Todavía no hay sesiones guardadas para este ejercicio.</p></div>';
                return;
            }

            elements.exerciseHistoryContainer.innerHTML = matchingSessions.map((session) => {
                const workoutDate = formatWorkoutDate(session.date) || session.date;
                const exercisesHtml = session.matchingExercises.map((item) => `
                    <div class="exercise-history-entry-sets">
                        ${(item.sets || []).length
                            ? (item.sets || []).map((set) => `<span class="set-tag">${formatSetTag({ ...set, type: item.type })}</span>`).join('')
                            : '<span class="set-tag">Sin series</span>'}
                    </div>
                `).join('');

                return `
                    <article class="exercise-history-entry">
                        <div class="exercise-history-entry-head">
                            <h3>${workoutDate}</h3>
                            <span class="exercise-history-entry-date">${session.date}</span>
                        </div>
                        ${exercisesHtml}
                    </article>
                `;
            }).join('');
        } catch (error) {
            console.error('Error cargando historial del ejercicio:', error);
            elements.exerciseHistorySubtitle.textContent = 'No se pudo cargar el historial';
            elements.exerciseHistoryContainer.innerHTML = '<div class="empty-state"><p>No se pudo cargar el historial de este ejercicio.</p></div>';
        }
    }

    function updateSetNumbers(setsContainer) {
        setsContainer.querySelectorAll('.set-row').forEach((row, index) => {
            row.querySelector('.set-number').textContent = `Serie ${index + 1}`;
        });
    }

    function deleteSet(exercise, set, setElement, setsContainer) {
        exercise.sets = exercise.sets.filter((item) => item !== set);
        setElement.remove();
        updateSetNumbers(setsContainer);
        persistence.markWorkoutDirty();
    }

    function toggleExerciseCollapse(exerciseElement, exercise, toggleBtn) {
        exerciseElement.classList.toggle('collapsed');
        exercise.collapsed = exerciseElement.classList.contains('collapsed');
        toggleBtn.setAttribute('aria-expanded', exercise.collapsed ? 'false' : 'true');
        toggleBtn.setAttribute('aria-label', exercise.collapsed ? `Expandir ${exercise.name}` : `Minimizar ${exercise.name}`);
        toggleBtn.setAttribute('title', exercise.collapsed ? `Expandir ${exercise.name}` : `Minimizar ${exercise.name}`);
        persistence.markWorkoutDirty();
    }

    function toggleGroupCollapse(groupSection, type) {
        const nextCollapsedState = !groupSection.classList.contains('collapsed');
        groupSection.classList.toggle('collapsed', nextCollapsedState);

        if (nextCollapsedState) {
            state.collapsedWorkoutGroups.add(type);
        } else {
            state.collapsedWorkoutGroups.delete(type);
        }

        persistence.markWorkoutDirty();
    }

    function focusNextSetInput(setsContainer, currentSetElement) {
        const rows = Array.from(setsContainer.querySelectorAll('.set-row'));
        const currentIndex = rows.indexOf(currentSetElement);
        const nextRow = currentIndex >= 0 ? rows[currentIndex + 1] : null;
        const nextPrimaryInput = nextRow?.querySelector('.set-primary-input');
        if (nextPrimaryInput) {
            nextPrimaryInput.focus();
            nextPrimaryInput.select?.();
            return true;
        }
        return false;
    }

    function createInputGroup({ className, placeholder, label, inputMode, step, min, enterKeyHint, type = 'number' }) {
        const inputGroup = document.createElement('div');
        inputGroup.className = 'input-group';

        const input = document.createElement('input');
        input.type = type;
        input.className = className;
        input.placeholder = placeholder;
        input.inputMode = inputMode;
        input.step = step;
        input.min = min;
        input.enterKeyHint = enterKeyHint;
        input.autocomplete = 'off';

        const inputLabel = document.createElement('span');
        inputLabel.className = 'input-label';
        inputLabel.textContent = label;

        inputGroup.append(input, inputLabel);
        return { inputGroup, input };
    }

    function configureSetInputs(exercise, set, setElement, confirmBtn, onChange) {
        const setInputs = setElement.querySelector('.set-inputs');
        const cardioExercise = isCardioType(exercise.type);
        setInputs.innerHTML = '';
        setInputs.classList.toggle('cardio-inputs', cardioExercise);

        if (cardioExercise) {
            const { inputGroup: minutesGroup, input: minutesInput } = createInputGroup({
                className: 'minutes-input set-primary-input',
                placeholder: 'Min',
                label: 'min',
                inputMode: 'numeric',
                step: '1',
                min: '0',
                enterKeyHint: 'next'
            });
            const { inputGroup: secondsGroup, input: secondsInput } = createInputGroup({
                className: 'seconds-input',
                placeholder: 'Seg',
                label: 'seg',
                inputMode: 'numeric',
                step: '1',
                min: '0',
                enterKeyHint: 'next'
            });
            const { inputGroup: speedGroup, input: speedInput } = createInputGroup({
                className: 'speed-input',
                placeholder: 'Vel.',
                label: 'km/h',
                inputMode: 'decimal',
                step: '0.1',
                min: '0',
                enterKeyHint: 'done'
            });

            const initialDuration = Number.isFinite(set.durationSeconds) ? Math.max(0, Math.round(set.durationSeconds)) : null;
            minutesInput.value = initialDuration === null ? '' : String(Math.floor(initialDuration / 60));
            secondsInput.value = initialDuration === null ? '' : String(initialDuration % 60);
            speedInput.value = set.avgSpeed ?? '';

            const inputs = [minutesInput, secondsInput, speedInput];
            inputs.forEach((input, index) => {
                input.addEventListener('input', onChange);
                input.addEventListener('keydown', (event) => {
                    if (event.key !== 'Enter') {
                        return;
                    }

                    event.preventDefault();
                    const nextInput = inputs[index + 1];
                    if (nextInput) {
                        nextInput.focus();
                        nextInput.select?.();
                        return;
                    }

                    confirmBtn.click();
                });
            });

            setInputs.append(minutesGroup, secondsGroup, speedGroup);

            return {
                focusInput: minutesInput,
                readValues() {
                    const hasDurationValue = minutesInput.value.trim() !== '' || secondsInput.value.trim() !== '';
                    const minutes = minutesInput.value.trim() === '' ? 0 : parseInt(minutesInput.value, 10);
                    const seconds = secondsInput.value.trim() === '' ? 0 : parseInt(secondsInput.value, 10);

                    return {
                        reps: null,
                        weight: null,
                        durationSeconds: hasDurationValue ? Math.max(0, ((Number.isFinite(minutes) ? minutes : 0) * 60) + (Number.isFinite(seconds) ? seconds : 0)) : null,
                        avgSpeed: speedInput.value.trim() === '' ? null : parseFloat(speedInput.value)
                    };
                }
            };
        }

        const { inputGroup: weightGroup, input: weightInput } = createInputGroup({
            className: 'weight-input set-primary-input',
            placeholder: 'Peso',
            label: 'kg',
            inputMode: 'decimal',
            step: '0.25',
            min: '0',
            enterKeyHint: 'next'
        });
        const { inputGroup: repsGroup, input: repsInput } = createInputGroup({
            className: 'reps-input',
            placeholder: 'Reps',
            label: 'Reps',
            inputMode: 'numeric',
            step: '1',
            min: '0',
            enterKeyHint: 'done'
        });

        weightInput.value = set.weight ?? '';
        repsInput.value = set.reps ?? '';

        weightInput.addEventListener('input', onChange);
        repsInput.addEventListener('input', onChange);
        weightInput.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter') {
                return;
            }

            event.preventDefault();
            repsInput.focus();
            repsInput.select?.();
        });
        repsInput.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter') {
                return;
            }

            event.preventDefault();
            confirmBtn.click();
        });

        setInputs.append(weightGroup, repsGroup);

        return {
            focusInput: weightInput,
            readValues() {
                return {
                    reps: repsInput.value.trim() === '' ? null : parseInt(repsInput.value, 10),
                    weight: weightInput.value.trim() === '' ? null : parseFloat(weightInput.value),
                    durationSeconds: null,
                    avgSpeed: null
                };
            }
        };
    }

    function createSetElement(exercise, set, setsContainer) {
        const setElement = elements.setTemplate.content.cloneNode(true).firstElementChild;
        const confirmBtn = setElement.querySelector('.confirm-set-btn');
        const deleteBtn = setElement.querySelector('.delete-set-btn');
        setElement.classList.toggle('completed', Boolean(set.completed));

        const updateSetData = () => {
            Object.assign(set, configuredInputs.readValues());
            persistence.markWorkoutDirty();
        };

        const configuredInputs = configureSetInputs(exercise, set, setElement, confirmBtn, updateSetData);

        confirmBtn.addEventListener('click', () => {
            updateSetData();
            set.completed = !set.completed;
            setElement.classList.toggle('completed', set.completed);
            persistence.markWorkoutDirty();

            if (!set.completed) {
                return;
            }

            if (focusNextSetInput(setsContainer, setElement)) {
                return;
            }

            addSet(exercise, setsContainer, true);
        });
        deleteBtn.addEventListener('click', () => deleteSet(exercise, set, setElement, setsContainer));

        return setElement;
    }

    function addSet(exercise, setsContainer, focusNewSet = false) {
        const set = createEmptySet(exercise.type);
        exercise.sets.push(set);
        const setElement = createSetElement(exercise, set, setsContainer);
        setsContainer.appendChild(setElement);
        updateSetNumbers(setsContainer);
        persistence.markWorkoutDirty();

        if (focusNewSet) {
            const primaryInput = setElement.querySelector('.set-primary-input');
            primaryInput?.focus();
        }
    }

    async function deleteExercise(exercise) {
        const confirmed = await dialogs.confirm('Eliminar ejercicio', `¿Eliminar "${exercise.name}"?`);
        if (!confirmed) {
            return;
        }

        state.currentWorkout.exercises = state.currentWorkout.exercises.filter((item) => item !== exercise);
        renderActiveWorkout();
        persistence.markWorkoutDirty();
    }

    function createExerciseElement(exercise) {
        const exerciseElement = elements.exerciseTemplate.content.cloneNode(true).firstElementChild;
        const exerciseHeader = exerciseElement.querySelector('.exercise-header');
        const title = exerciseElement.querySelector('.exercise-title');
        const badge = exerciseElement.querySelector('.exercise-group-badge');
        const deleteBtn = exerciseElement.querySelector('.delete-exercise-btn');
        const toggleBtn = exerciseElement.querySelector('.toggle-exercise-btn');
        const historyBtn = exerciseElement.querySelector('.exercise-history-btn');
        const setsContainer = exerciseElement.querySelector('.sets-container');
        const addSetBtn = exerciseElement.querySelector('.add-set-btn');

        title.textContent = exercise.name;
        badge.textContent = exercise.type === 'Sin Grupo' ? 'Sin grupo' : exercise.type;
        badge.title = isCardioType(exercise.type) ? 'Ejercicio de cardio con tiempo y velocidad media' : badge.textContent;
        deleteBtn.addEventListener('click', () => deleteExercise(exercise));
        historyBtn?.addEventListener('click', () => openExerciseHistory(exercise));
        historyBtn?.setAttribute('aria-label', `Ver historial de ${exercise.name}`);
        historyBtn?.setAttribute('title', `Ver historial de ${exercise.name}`);
        addSetBtn.addEventListener('click', () => addSet(exercise, setsContainer, true));

        if (exercise.collapsed) {
            exerciseElement.classList.add('collapsed');
        }

        toggleBtn.setAttribute('aria-expanded', exercise.collapsed ? 'false' : 'true');
        toggleBtn.setAttribute('aria-label', exercise.collapsed ? `Expandir ${exercise.name}` : `Minimizar ${exercise.name}`);
        toggleBtn.setAttribute('title', exercise.collapsed ? `Expandir ${exercise.name}` : `Minimizar ${exercise.name}`);

        toggleBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            toggleExerciseCollapse(exerciseElement, exercise, toggleBtn);
        });

        exerciseHeader?.addEventListener('click', (event) => {
            if (event.target.closest('.exercise-controls')) {
                return;
            }

            toggleExerciseCollapse(exerciseElement, exercise, toggleBtn);
        });

        return exerciseElement;
    }

    async function deleteMuscleGroup(type) {
        const confirmed = await dialogs.confirm('Eliminar grupo muscular', `¿Eliminar "${type}" y todos sus ejercicios?`);
        if (!confirmed) {
            return;
        }

        state.currentWorkout.exercises = state.currentWorkout.exercises.filter((exercise) => exercise.type !== type);
        state.selectedMuscleGroups.delete(type);
        state.collapsedWorkoutGroups.delete(type);
        renderActiveWorkout();
        persistence.markWorkoutDirty();
    }

    function renderGroupSection(type, exercises) {
        const groupSection = document.createElement('section');
        groupSection.className = 'muscle-group-section';
        if (type === 'Sin Grupo') {
            groupSection.classList.add('muted-group-section');
        }

        const groupHeaderDiv = document.createElement('div');
        groupHeaderDiv.className = 'muscle-group-header';
        if (type === 'Sin Grupo') {
            groupHeaderDiv.classList.add('muted-group-header');
        }

        groupHeaderDiv.innerHTML = `
            <h3>${type === 'Sin Grupo' ? 'Otros ejercicios' : type}</h3>
            ${type === 'Sin Grupo' ? '' : `<button class="delete-muscle-group-btn" data-type="${type}" title="Eliminar grupo y sus ejercicios">✕</button>`}
        `;
        groupSection.appendChild(groupHeaderDiv);

        if (state.collapsedWorkoutGroups.has(type)) {
            groupSection.classList.add('collapsed');
        }

        const deleteButton = groupHeaderDiv.querySelector('.delete-muscle-group-btn');
        if (deleteButton) {
            deleteButton.addEventListener('click', (event) => {
                event.stopPropagation();
                deleteMuscleGroup(type);
            });
        }

        groupHeaderDiv.addEventListener('click', (event) => {
            if (event.target.closest('.delete-muscle-group-btn')) {
                return;
            }

            toggleGroupCollapse(groupSection, type);
        });

        const groupBody = document.createElement('div');
        groupBody.className = 'muscle-group-body';
        groupSection.appendChild(groupBody);

        exercises.forEach((exercise) => {
            const exerciseElement = createExerciseElement(exercise);
            groupBody.appendChild(exerciseElement);
            const setsContainer = exerciseElement.querySelector('.sets-container');
            exercise.sets.forEach((set) => {
                setsContainer.appendChild(createSetElement(exercise, set, setsContainer));
            });
            updateSetNumbers(setsContainer);
        });

        elements.exercisesContainer.appendChild(groupSection);
    }

    function renderActiveWorkout() {
        elements.exercisesContainer.innerHTML = '';

        if (!state.currentWorkout) {
            return;
        }

        const normalizedWorkout = normalizeWorkoutData(state.currentWorkout);
        state.currentWorkout.exercises = normalizedWorkout?.exercises || [];
        state.currentWorkout.types = deriveWorkoutTypes(state.currentWorkout.exercises, getSelectedTypes(state));
        setSelectedTypes(state, state.currentWorkout.types);

        updateSelectedTypesDisplay();
        updateWorkoutDateDisplay();
        populateExerciseTypeOptions();
        syncMuscleGroupSelection();

        const groupedExercises = new Map();
        getSelectedTypes(state).forEach((type) => groupedExercises.set(type, []));
        state.currentWorkout.exercises.forEach((exercise) => {
            const type = exercise.type || 'Sin Grupo';
            if (!groupedExercises.has(type)) {
                groupedExercises.set(type, []);
            }
            groupedExercises.get(type).push(exercise);
        });

        groupedExercises.forEach((groupExercises, type) => renderGroupSection(type, groupExercises));

        if (!groupedExercises.size) {
            elements.exercisesContainer.appendChild(createEmptyState('Empieza seleccionando un grupo muscular para cargar ejercicios recientes.'));
        }

        switchTab('workout');
    }

    async function startWorkout() {
        const date = elements.workoutDateInput.value;
        if (!date) {
            await dialogs.alert('Falta información', 'Selecciona una fecha para empezar el entrenamiento.');
            return;
        }

        state.currentWorkout = { date, exercises: [], types: [] };
        state.collapsedWorkoutGroups = new Set();
        setSelectedTypes(state, []);
        elements.exerciseNameInput.value = '';
        renderActiveWorkout();
        persistence.markWorkoutDirty();
        persistence.startAutoSave();
        setSaveStatusText('', 'success');
        openMuscleGroupPicker();
    }

    async function loadExercisesForSelectedGroups({ silentIfEmpty = false } = {}) {
        if (!state.currentWorkout) {
            await dialogs.alert('Sin entrenamiento', 'Primero tienes que iniciar un entrenamiento.');
            return;
        }

        const selectedGroups = getSelectedMuscleGroupsFromControl();
        const previousGroups = new Set(getSelectedTypes(state));
        const removedGroups = Array.from(previousGroups).filter((type) => !selectedGroups.includes(type));

        if (removedGroups.length) {
            state.currentWorkout.exercises = state.currentWorkout.exercises.filter((exercise) => !removedGroups.includes(exercise.type));
        }

        setSelectedTypes(state, selectedGroups);

        if (!selectedGroups.length) {
            renderActiveWorkout();
            persistence.markWorkoutDirty();

            if (silentIfEmpty) {
                return;
            }

            await dialogs.alert('Selecciona un grupo', 'Selecciona al menos un grupo muscular.');
            return;
        }

        elements.loadExercisesBtn.disabled = true;
        elements.loadExercisesBtn.textContent = 'Cargando...';

        try {
            for (const type of selectedGroups) {
                if (!type) {
                    continue;
                }

                const latestExercises = await api.getLatestExercises(type);
                latestExercises.forEach((exercise) => {
                    const normalizedExercise = normalizeExercise({ ...exercise, type }, type);
                    if (!normalizedExercise) {
                        return;
                    }

                    normalizedExercise.sets = normalizedExercise.sets.map((set) => ({
                        ...set,
                        completed: false
                    }));

                    const alreadyExists = state.currentWorkout.exercises.some((currentExercise) => (
                        currentExercise.type === normalizedExercise.type &&
                        currentExercise.name.toLowerCase() === normalizedExercise.name.toLowerCase()
                    ));

                    if (alreadyExists) {
                        return;
                    }

                    normalizedExercise.collapsed = true;
                    state.currentWorkout.exercises.push(normalizedExercise);
                });
            }

            renderActiveWorkout();
            persistence.markWorkoutDirty();
        } catch (error) {
            console.error('Error cargando ejercicios:', error);
            await dialogs.alert('Error', 'No se pudieron cargar los ejercicios recientes.');
        } finally {
            elements.loadExercisesBtn.disabled = false;
            elements.loadExercisesBtn.textContent = 'Cargar Ejercicios Seleccionados';
        }
    }

    async function addExercise() {
        if (!state.currentWorkout) {
            await dialogs.alert('Sin entrenamiento', 'Primero tienes que iniciar un entrenamiento.');
            return;
        }

        const exerciseName = elements.exerciseNameInput.value.trim();
        const exerciseType = elements.exerciseTypeSelect.value || 'Sin Grupo';
        if (!exerciseName) {
            return;
        }

        const alreadyExists = state.currentWorkout.exercises.some((exercise) => (
            exercise.type === exerciseType &&
            exercise.name.toLowerCase() === exerciseName.toLowerCase()
        ));

        if (alreadyExists) {
            await dialogs.alert('Ejercicio existente', 'Ese ejercicio ya existe dentro del grupo seleccionado.');
            return;
        }

        if (exerciseType !== 'Sin Grupo') {
            state.selectedMuscleGroups.add(exerciseType);
        }

        state.currentWorkout.exercises.push({
            name: exerciseName,
            type: exerciseType,
            sets: [],
            collapsed: false
        });

        elements.exerciseNameInput.value = '';
        renderActiveWorkout();
        persistence.markWorkoutDirty();
        elements.exerciseNameInput.focus();
    }

    async function finishWorkout() {
        if (!state.currentWorkout) {
            return;
        }

        const payload = buildDraftPayload(state.currentWorkout, getSelectedTypes(state));
        if (!payload?.types.length) {
            await dialogs.alert('Falta grupo muscular', 'Selecciona al menos un grupo muscular antes de guardar.');
            return;
        }

        const confirmed = await dialogs.confirm('Guardar entrenamiento', '¿Quieres guardar este entrenamiento?');
        if (!confirmed) {
            return;
        }

        elements.finishWorkoutBtn.disabled = true;
        elements.finishWorkoutBtn.textContent = 'Guardando...';

        try {
            await dialogs.withLoading('Guardando entrenamiento...', async () => {
                await api.saveWorkout(payload);
                await api.deleteDraft();
            });
            persistence.clearPersistedDraft();
            state.draftDirty = false;
            await dialogs.alert('Entrenamiento guardado', 'El entrenamiento se ha guardado correctamente.');
            await resetApp(false);
        } catch (error) {
            console.error('Error guardando entrenamiento:', error);
            await dialogs.alert('Error', 'Hubo un problema al guardar el entrenamiento.');
        } finally {
            elements.finishWorkoutBtn.disabled = false;
            elements.finishWorkoutBtn.textContent = 'Guardar';
        }
    }

    async function resetApp(deleteServerDraft = true) {
        persistence.stopAutoSave();
        state.currentWorkout = null;
        state.collapsedWorkoutGroups = new Set();
        setSelectedTypes(state, []);
        elements.exercisesContainer.innerHTML = '';
        elements.exerciseNameInput.value = '';
        populateExerciseTypeOptions();
        persistence.clearPersistedDraft();
        state.draftDirty = false;
        setSaveStatusText('Sin cambios pendientes', 'muted');

        if (deleteServerDraft) {
            try {
                await api.deleteDraft();
            } catch (error) {
                console.error('Error eliminando borrador del servidor:', error);
            }
        }

        switchTab('workout');
    }

    async function cancelWorkout() {
        const confirmed = await dialogs.confirm('Cancelar entrenamiento', 'Se perderá el progreso del borrador actual. ¿Quieres continuar?');
        if (!confirmed) {
            return;
        }

        await dialogs.withLoading('Cancelando entrenamiento...', async () => {
            await resetApp(true);
        });
    }

    function init() {
        elements.startWorkoutBtn.addEventListener('click', startWorkout);
        elements.addExerciseBtn.addEventListener('click', addExercise);
        elements.finishWorkoutBtn.addEventListener('click', finishWorkout);
        elements.cancelWorkoutBtn.addEventListener('click', cancelWorkout);
        elements.viewHistoryBtn.addEventListener('click', showHistory);
        elements.loadExercisesBtn?.addEventListener('click', loadExercisesForSelectedGroups);
        elements.muscleGroupToggleBtn?.addEventListener('click', openMuscleGroupPicker);
        elements.muscleGroupSelect?.addEventListener('change', () => {
            loadExercisesForSelectedGroups({ silentIfEmpty: true });
        });
        elements.closeExerciseHistoryBtn?.addEventListener('click', closeExerciseHistoryModal);

        elements.exerciseHistoryModal?.addEventListener('click', (event) => {
            if (event.target === elements.exerciseHistoryModal) {
                closeExerciseHistoryModal();
            }
        });
        elements.exerciseNameInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                addExercise();
            }
        });
    }

    return {
        init,
        renderActiveWorkout,
        populateExerciseTypeOptions,
        resetApp
    };
}