import { createAppState, setSelectedTypes } from './state.js';
import { api } from './services/api.js';
import { createPersistenceService } from './services/persistence.js';
import { createDialogController } from './ui/dialogs.js';
import { createHistoryController } from './ui/history.js';
import { createNutritionController } from './ui/nutrition.js';
import { createProgressController } from './ui/progress.js';
import { createWorkoutController } from './ui/workout.js';

const STORAGE_KEY_PREFIX = 'app-entrenamiento-active-workout';
const ACTIVE_TAB_KEY_PREFIX = 'app-entrenamiento-active-tab';
const AUTH_USER_KEY = 'app-entrenamiento-auth-user';
const THEME_STORAGE_KEY = 'app-entrenamiento-theme';
const LOCAL_SAVE_INTERVAL = 3000;
const SERVER_SAVE_INTERVAL = 30000;

function getElements() {
    return {
        authView: document.getElementById('auth-view'),
        authForm: document.getElementById('auth-form'),
        appShell: document.getElementById('app-shell'),
        mainNav: document.getElementById('main-nav'),
        loginUsernameInput: document.getElementById('login-username'),
        loginPasswordInput: document.getElementById('login-password'),
        togglePasswordBtn: document.getElementById('toggle-password-btn'),
        loginBtn: document.getElementById('login-btn'),
        registerBtn: document.getElementById('register-btn'),
        authStatus: document.getElementById('auth-status'),
        userSessionBar: document.getElementById('user-session-bar'),
        userMenuBtn: document.getElementById('user-menu-btn'),
        userMenuPopover: document.getElementById('user-menu-popover'),
        currentUserDisplay: document.getElementById('current-user-display'),
        currentUserName: document.getElementById('current-user-name'),
        themeToggleBtn: document.getElementById('theme-toggle-btn'),
        themeToggleHint: document.getElementById('theme-toggle-hint'),
        logoutBtn: document.getElementById('logout-btn'),
        setupView: document.getElementById('setup-view'),
        activeWorkoutView: document.getElementById('active-workout-view'),
        historyView: document.getElementById('history-view'),
        progressView: document.getElementById('progress-view'),
        nutritionView: document.getElementById('nutrition-view'),
        workoutDateInput: document.getElementById('workout-date'),
        muscleGroupToggleBtn: document.getElementById('muscle-group-toggle-btn'),
        muscleGroupSelect: document.getElementById('muscle-group-select'),
        loadExercisesBtn: document.getElementById('load-exercises-btn'),
        startWorkoutBtn: document.getElementById('start-workout-btn'),
        workoutTypeDisplay: document.getElementById('workout-type-display'),
        workoutDateDisplay: document.getElementById('workout-date-display'),
        saveStatus: document.getElementById('save-status'),
        exercisesContainer: document.getElementById('exercises-container'),
        exerciseTypeSelect: document.getElementById('exercise-type-select'),
        exerciseNameInput: document.getElementById('exercise-name-input'),
        addExerciseBtn: document.getElementById('add-exercise-btn'),
        finishWorkoutBtn: document.getElementById('finish-workout-btn'),
        viewHistoryBtn: document.getElementById('view-history-btn'),
        cancelWorkoutBtn: document.getElementById('cancel-workout-btn'),
        navNewWorkoutBtn: document.getElementById('nav-new-workout'),
        navHistoryBtn: document.getElementById('nav-history'),
        navProgressBtn: document.getElementById('nav-progress'),
        navNutritionBtn: document.getElementById('nav-nutrition'),
        historyFilterType: document.getElementById('history-filter-type'),
        historyFilterDate: document.getElementById('history-filter-date'),
        historyFilterMonth: document.getElementById('history-filter-month'),
        historyFilterExercise: document.getElementById('history-filter-exercise'),
        historyExerciseOptions: document.getElementById('history-exercise-options'),
        applyFiltersBtn: document.getElementById('apply-filters-btn'),
        clearFiltersBtn: document.getElementById('clear-filters-btn'),
        toggleHistoryToolsBtn: document.getElementById('toggle-history-tools-btn'),
        historyToolsPanel: document.getElementById('history-tools-panel'),
        historyOverviewShell: document.getElementById('history-overview-shell'),
        historyOverview: document.getElementById('history-overview'),
        fullHistoryContainer: document.getElementById('full-history-container'),
        historyModal: document.getElementById('history-modal'),
        closeModalBtn: document.getElementById('close-modal-btn'),
        historyContainer: document.getElementById('history-container'),
        historyMuscleGroup: document.getElementById('history-muscle-group'),
        dialogModal: document.getElementById('dialog-modal'),
        dialogTitle: document.getElementById('dialog-title'),
        dialogMessage: document.getElementById('dialog-message'),
        dialogCancelBtn: document.getElementById('dialog-cancel-btn'),
        dialogConfirmBtn: document.getElementById('dialog-confirm-btn'),
        chartModal: document.getElementById('chart-modal'),
        closeChartBtn: document.getElementById('close-chart-btn'),
        chartTitle: document.getElementById('chart-title'),
        chartSubtitle: document.getElementById('chart-subtitle'),
        chartMetricTabs: document.getElementById('chart-metric-tabs'),
        chartStatGrid: document.getElementById('chart-stat-grid'),
        chartCanvas: document.getElementById('chart-canvas'),
        exerciseHistoryModal: document.getElementById('exercise-history-modal'),
        closeExerciseHistoryBtn: document.getElementById('close-exercise-history-btn'),
        exerciseHistoryTitle: document.getElementById('exercise-history-title'),
        exerciseHistorySubtitle: document.getElementById('exercise-history-subtitle'),
        exerciseHistoryContainer: document.getElementById('exercise-history-container'),
        progressSummaryGrid: document.getElementById('progress-summary-grid'),
        progressMonthLabel: document.getElementById('progress-month-label'),
        progressPrevMonthBtn: document.getElementById('progress-prev-month-btn'),
        progressNextMonthBtn: document.getElementById('progress-next-month-btn'),
        progressCalendarGrid: document.getElementById('progress-calendar-grid'),
        bodyWeightDateInput: document.getElementById('body-weight-date'),
        bodyWeightInput: document.getElementById('body-weight-input'),
        saveBodyWeightBtn: document.getElementById('save-body-weight-btn'),
        bodyWeightStatus: document.getElementById('body-weight-status'),
        bodyWeightSummary: document.getElementById('body-weight-summary'),
        bodyWeightHistory: document.getElementById('body-weight-history'),
        bodyWeightChart: document.getElementById('body-weight-chart'),
        nutritionDateInput: document.getElementById('nutrition-date'),
        nutritionMealSelect: document.getElementById('nutrition-meal'),
        nutritionFoodNameInput: document.getElementById('nutrition-food-name'),
        nutritionFoodGramsInput: document.getElementById('nutrition-food-grams'),
        nutritionFoodCaloriesInput: document.getElementById('nutrition-food-calories'),
        nutritionFoodProteinInput: document.getElementById('nutrition-food-protein'),
        nutritionFoodCarbsInput: document.getElementById('nutrition-food-carbs'),
        nutritionFoodFatInput: document.getElementById('nutrition-food-fat'),
        nutritionFoodNotesInput: document.getElementById('nutrition-food-notes'),
        nutritionGoalCaloriesInput: document.getElementById('nutrition-goal-calories'),
        nutritionGoalProteinInput: document.getElementById('nutrition-goal-protein'),
        nutritionGoalCarbsInput: document.getElementById('nutrition-goal-carbs'),
        nutritionGoalFatInput: document.getElementById('nutrition-goal-fat'),
        saveNutritionGoalsBtn: document.getElementById('save-nutrition-goals-btn'),
        saveNutritionEntryBtn: document.getElementById('save-nutrition-entry-btn'),
        nutritionSummaryGrid: document.getElementById('nutrition-summary-grid'),
        nutritionDayStatus: document.getElementById('nutrition-day-status'),
        nutritionEntriesContainer: document.getElementById('nutrition-entries-container'),
        nutritionRecentDays: document.getElementById('nutrition-recent-days'),
        exerciseTemplate: document.getElementById('exercise-template'),
        setTemplate: document.getElementById('set-template')
    };
}

export function initApp() {
    const elements = getElements();
    const state = createAppState();
    const bootState = window.__TRAINING_APP_BOOT__ || null;
    const systemThemeMediaQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    const today = new Date().toISOString().split('T')[0];
    const navTabs = [
        { name: 'workout', button: elements.navNewWorkoutBtn },
        { name: 'history', button: elements.navHistoryBtn },
        { name: 'progress', button: elements.navProgressBtn },
        { name: 'nutrition', button: elements.navNutritionBtn }
    ];
    let navDragState = null;

    function setSaveStatusText(text, tone = 'muted') {
        elements.saveStatus.textContent = text;
        elements.saveStatus.dataset.tone = tone;
        elements.saveStatus.classList.toggle('is-visible', Boolean(text));
    }

    function setAuthStatusText(text, tone = 'muted') {
        elements.authStatus.textContent = text;
        elements.authStatus.dataset.tone = tone;
        elements.authStatus.classList.toggle('is-visible', Boolean(text));
    }

    function getStoredThemePreference() {
        try {
            const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
            return storedTheme === 'light' || storedTheme === 'dark' ? storedTheme : null;
        } catch (error) {
            return null;
        }
    }

    function getSystemTheme() {
        return systemThemeMediaQuery?.matches ? 'dark' : 'light';
    }

    function getEffectiveTheme() {
        return getStoredThemePreference() || getSystemTheme();
    }

    function updateThemeToggle(theme, automatic = false) {
        if (!elements.themeToggleBtn) {
            return;
        }

        const isLight = theme === 'light';
        elements.themeToggleBtn.setAttribute('aria-checked', isLight ? 'true' : 'false');
        elements.themeToggleBtn.setAttribute('aria-label', isLight ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro');
        if (elements.themeToggleHint) {
            elements.themeToggleHint.textContent = automatic
                ? 'Automático según el sistema'
                : (isLight ? 'Fijado en claro' : 'Fijado en oscuro');
        }
    }

    function applyTheme(theme, automatic = false) {
        document.documentElement.dataset.theme = theme;
        document.documentElement.style.colorScheme = theme;
        updateThemeToggle(theme, automatic);
    }

    function toggleTheme() {
        const nextTheme = getEffectiveTheme() === 'dark' ? 'light' : 'dark';
        try {
            window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
        } catch (error) {
            // Ignore write failures and still apply in-memory for this session.
        }
        applyTheme(nextTheme, false);
    }

    function syncThemeWithSystem() {
        const storedPreference = getStoredThemePreference();
        if (storedPreference) {
            applyTheme(storedPreference, false);
            return;
        }

        applyTheme(getSystemTheme(), true);
    }

    function formatUserName(username) {
        const normalized = String(username || '').trim();
        if (!normalized) {
            return '';
        }

        return normalized.charAt(0).toUpperCase() + normalized.slice(1);
    }

    function getUserInitial(username) {
        return formatUserName(username).charAt(0) || '';
    }

    function closeUserMenu() {
        elements.userMenuPopover.classList.add('hidden');
        elements.userMenuBtn.setAttribute('aria-expanded', 'false');
    }

    function toggleUserMenu() {
        const isHidden = elements.userMenuPopover.classList.contains('hidden');
        elements.userMenuPopover.classList.toggle('hidden', !isHidden);
        elements.userMenuBtn.setAttribute('aria-expanded', isHidden ? 'true' : 'false');
    }

    function setAuthLoading(isLoading, action = 'login') {
        elements.loginBtn.disabled = isLoading;
        elements.registerBtn.disabled = isLoading;
        elements.loginUsernameInput.disabled = isLoading;
        elements.loginPasswordInput.disabled = isLoading;
        elements.togglePasswordBtn.disabled = isLoading;

        if (!isLoading) {
            elements.loginBtn.textContent = 'Entrar';
            elements.registerBtn.textContent = 'Crear usuario';
            return;
        }

        elements.loginBtn.textContent = action === 'register' ? 'Creando...' : 'Entrando...';
        elements.registerBtn.textContent = action === 'register' ? 'Creando...' : 'Crear usuario';
    }

    function setPasswordVisibility(isVisible) {
        const nextType = isVisible ? 'text' : 'password';
        const nextLabel = isVisible ? 'Ocultar' : 'Ver';
        const nextAria = isVisible ? 'Ocultar contraseña' : 'Mostrar contraseña';
        const label = elements.togglePasswordBtn.querySelector('.toggle-password-text');

        elements.loginPasswordInput.type = nextType;
        elements.togglePasswordBtn.dataset.visible = isVisible ? 'true' : 'false';
        elements.togglePasswordBtn.setAttribute('aria-label', nextAria);
        elements.togglePasswordBtn.setAttribute('title', nextAria);
        if (label) {
            label.textContent = nextLabel;
        }
    }

    function getStorageKey() {
        if (!state.currentUser) {
            return null;
        }

        return `${STORAGE_KEY_PREFIX}-${state.currentUser}`;
    }

    function persistAuthenticatedUser(username) {
        try {
            window.localStorage.setItem(AUTH_USER_KEY, username);
        } catch (error) {
            state.inMemoryStorage[AUTH_USER_KEY] = username;
        }
    }

    function clearPersistedAuthenticatedUser() {
        try {
            window.localStorage.removeItem(AUTH_USER_KEY);
        } catch (error) {
            delete state.inMemoryStorage[AUTH_USER_KEY];
        }
    }

    function getActiveTabStorageKey() {
        if (!state.currentUser) {
            return null;
        }

        return `${ACTIVE_TAB_KEY_PREFIX}-${state.currentUser}`;
    }

    function persistActiveTab(tabName) {
        const storageKey = getActiveTabStorageKey();
        if (!storageKey) {
            return;
        }

        try {
            window.localStorage.setItem(storageKey, tabName);
        } catch (error) {
            state.inMemoryStorage[storageKey] = tabName;
        }
    }

    function restoreActiveTab() {
        const storageKey = getActiveTabStorageKey();
        if (!storageKey) {
            return 'workout';
        }

        try {
            const restored = window.localStorage.getItem(storageKey);
            if (restored) {
                return restored;
            }
        } catch (error) {
            // Ignore storage read failures and fall back to memory/default.
        }

        return state.inMemoryStorage[storageKey] || 'workout';
    }

    function updateNavHighlight(targetButton = null) {
        const nav = elements.mainNav;
        const activeButton = targetButton || nav?.querySelector('.nav-btn.active');
        if (!nav || !activeButton) {
            return;
        }

        const navRect = nav.getBoundingClientRect();
        const buttonRect = activeButton.getBoundingClientRect();
        nav.style.setProperty('--nav-highlight-x', `${buttonRect.left - navRect.left}px`);
        nav.style.setProperty('--nav-highlight-y', `${buttonRect.top - navRect.top}px`);
        nav.style.setProperty('--nav-highlight-width', `${buttonRect.width}px`);
        nav.style.setProperty('--nav-highlight-height', `${buttonRect.height}px`);
    }

    function getClosestNavTab(clientX) {
        const nav = elements.mainNav;
        if (!nav) {
            return null;
        }

        let closest = null;
        let smallestDistance = Number.POSITIVE_INFINITY;
        navTabs.forEach((entry) => {
            if (!entry.button) {
                return;
            }

            const rect = entry.button.getBoundingClientRect();
            const center = rect.left + (rect.width / 2);
            const distance = Math.abs(center - clientX);
            if (distance < smallestDistance) {
                smallestDistance = distance;
                closest = { ...entry, rect };
            }
        });

        return closest;
    }

    function updateNavHighlightFromPointer(clientX) {
        const nav = elements.mainNav;
        if (!nav) return;

        const navRect = nav.getBoundingClientRect();
        const pad = 6;

        // Snap capsule dimensions to closest tab, but let X follow the pointer
        const closest = getClosestNavTab(clientX);
        if (!closest) return;

        const capsuleW = closest.rect.width;
        const capsuleH = closest.rect.height;
        const minX = pad;
        const maxX = navRect.width - capsuleW - pad;
        const rawX = clientX - navRect.left - capsuleW / 2;
        const clampedX = Math.min(Math.max(rawX, minX), maxX);

        nav.style.setProperty('--nav-highlight-x', `${clampedX}px`);
        nav.style.setProperty('--nav-highlight-y', `${closest.rect.top - navRect.top}px`);
        nav.style.setProperty('--nav-highlight-width', `${capsuleW}px`);
        nav.style.setProperty('--nav-highlight-height', `${capsuleH}px`);
    }

    const DRAG_THRESHOLD = 6; // px of movement before switching from tap to drag

    function finishNavDrag(activate) {
        const nav = elements.mainNav;
        if (!nav || !navDragState) return;

        const { lastClientX, pointerId, dragging } = navDragState;
        const closest = getClosestNavTab(lastClientX);

        // Always re-enable transitions for the snap animation
        nav.classList.remove('is-dragging');

        if (activate && closest) {
            switchTab(closest.name);
        } else {
            // Snap back to the current active tab smoothly
            updateNavHighlight();
        }

        try {
            if (pointerId != null && nav.hasPointerCapture?.(pointerId)) {
                nav.releasePointerCapture(pointerId);
            }
        } catch (_) { /* already released */ }

        navDragState = null;
    }

    function initNavDrag() {
        const nav = elements.mainNav;
        if (!nav) return;

        nav.addEventListener('pointerdown', (event) => {
            if (event.pointerType === 'mouse' && event.button !== 0) return;
            if (navDragState) finishNavDrag(false);

            navDragState = {
                pointerId: event.pointerId,
                startX: event.clientX,
                lastClientX: event.clientX,
                dragging: false // becomes true after threshold
            };

            try { nav.setPointerCapture?.(event.pointerId); } catch (_) {}
        });

        nav.addEventListener('pointermove', (event) => {
            if (!navDragState || navDragState.pointerId !== event.pointerId) return;

            navDragState.lastClientX = event.clientX;

            if (!navDragState.dragging) {
                if (Math.abs(event.clientX - navDragState.startX) < DRAG_THRESHOLD) return;
                // Crossed threshold → enter drag mode
                navDragState.dragging = true;
                nav.classList.add('is-dragging');
            }

            updateNavHighlightFromPointer(event.clientX);
        });

        nav.addEventListener('pointerup', (event) => {
            if (!navDragState || navDragState.pointerId !== event.pointerId) return;

            if (!navDragState.dragging) {
                // It was a tap — find which tab was tapped
                const tapped = getClosestNavTab(event.clientX);
                navDragState = null;
                try { nav.releasePointerCapture?.(event.pointerId); } catch (_) {}
                if (tapped) switchTab(tapped.name);
                return;
            }

            finishNavDrag(true);
        });

        nav.addEventListener('pointercancel', (event) => {
            if (navDragState?.pointerId === event.pointerId) finishNavDrag(false);
        });

        nav.addEventListener('lostpointercapture', (event) => {
            // Only handle if drag is still in progress (pointerup didn't fire)
            if (navDragState?.pointerId === event.pointerId) finishNavDrag(true);
        });
    }

    function resetWorkoutState() {
        state.currentWorkout = null;
        setSelectedTypes(state, []);
        elements.exercisesContainer.innerHTML = '';
        elements.exerciseNameInput.value = '';
        elements.workoutDateInput.value = today;
        elements.bodyWeightDateInput.value = today;
        workoutController.populateExerciseTypeOptions();
        elements.setupView.classList.remove('hidden');
        elements.activeWorkoutView.classList.add('hidden');
        elements.historyView.classList.add('hidden');
        elements.progressView.classList.add('hidden');
        elements.nutritionView.classList.add('hidden');
        setSaveStatusText('', 'success');
    }

    function showAuthView(statusText = '', tone = 'muted') {
        document.body.classList.remove('is-boot-restoring');
        elements.authView.classList.remove('hidden');
        elements.appShell.classList.add('hidden');
        elements.userSessionBar.classList.add('hidden');
        elements.currentUserDisplay.textContent = '';
        elements.currentUserName.textContent = '';
        closeUserMenu();
        resetWorkoutState();
        setAuthLoading(false);
        setAuthStatusText(statusText, tone);
    }

    function showAppShell() {
        document.body.classList.remove('is-boot-restoring');
        elements.authView.classList.add('hidden');
        elements.appShell.classList.remove('hidden');
        elements.userSessionBar.classList.remove('hidden');
        elements.currentUserDisplay.textContent = getUserInitial(state.currentUser);
        elements.currentUserName.textContent = formatUserName(state.currentUser);
        closeUserMenu();
        setAuthLoading(false);
        setAuthStatusText('', 'success');
    }

    function switchTab(tabName) {
        if (!state.currentUser) {
            return;
        }

        state.activeTab = tabName;
        persistActiveTab(tabName);

        const showWorkout = tabName === 'workout';
        const showHistory = tabName === 'history';
        const showProgress = tabName === 'progress';
        const showNutrition = tabName === 'nutrition';
        elements.navNewWorkoutBtn.classList.toggle('active', showWorkout);
        elements.navHistoryBtn.classList.toggle('active', showHistory);
        elements.navProgressBtn.classList.toggle('active', showProgress);
        elements.navNutritionBtn.classList.toggle('active', showNutrition);
        elements.historyView.classList.toggle('hidden', !showHistory);
        elements.progressView.classList.toggle('hidden', !showProgress);
        elements.nutritionView.classList.toggle('hidden', !showNutrition);
        requestAnimationFrame(() => updateNavHighlight());

        if (showWorkout) {
            if (state.currentWorkout) {
                elements.setupView.classList.add('hidden');
                elements.activeWorkoutView.classList.remove('hidden');
            } else {
                elements.setupView.classList.remove('hidden');
                elements.activeWorkoutView.classList.add('hidden');
            }
            return;
        }

        elements.setupView.classList.add('hidden');
        elements.activeWorkoutView.classList.add('hidden');
        if (showHistory) {
            elements.historyView.classList.remove('hidden');
            historyController.loadFullHistory();
            return;
        }

        if (showNutrition) {
            elements.nutritionView.classList.remove('hidden');
            nutritionController.loadNutrition();
            return;
        }

        elements.progressView.classList.remove('hidden');
        progressController.loadProgress();
    }

    const dialogs = createDialogController({
        state,
        dialogModal: elements.dialogModal,
        dialogTitle: elements.dialogTitle,
        dialogMessage: elements.dialogMessage,
        dialogCancelBtn: elements.dialogCancelBtn,
        dialogConfirmBtn: elements.dialogConfirmBtn
    });

    const persistence = createPersistenceService({
        state,
        api,
        getStorageKey,
        localSaveInterval: LOCAL_SAVE_INTERVAL,
        serverSaveInterval: SERVER_SAVE_INTERVAL,
        setSaveStatusText
    });

    const historyController = createHistoryController({ elements, state, api, dialogs });
    const progressController = createProgressController({ elements, state, api, dialogs });
    const nutritionController = createNutritionController({ elements, state, api, dialogs });
    const workoutController = createWorkoutController({
        elements,
        state,
        api,
        dialogs,
        persistence,
        switchTab,
        showHistory: () => historyController.showHistory(),
        setSaveStatusText
    });

    elements.workoutDateInput.value = today;
    workoutController.populateExerciseTypeOptions();

    dialogs.init();
    historyController.init();
    progressController.init();
    nutritionController.init();
    workoutController.init();
    initNavDrag();

    async function restoreAuthenticatedWorkspace() {
        resetWorkoutState();
        showAppShell();

        const restoredWorkout = await persistence.restoreSession();
        if (!restoredWorkout) {
            switchTab(restoreActiveTab());
            return;
        }

        state.currentWorkout = {
            date: restoredWorkout.date,
            exercises: restoredWorkout.exercises,
            id: restoredWorkout.id,
            types: restoredWorkout.types
        };
        setSelectedTypes(state, restoredWorkout.types);
        elements.workoutDateInput.value = restoredWorkout.date;
        workoutController.renderActiveWorkout();
        persistence.startAutoSave();
        state.draftDirty = false;
        setSaveStatusText('', 'success');
        switchTab(restoreActiveTab());
    }

    async function authenticate(action) {
        const username = elements.loginUsernameInput.value.trim();
        const password = elements.loginPasswordInput.value;

        if (!username || !password) {
            setAuthStatusText('Introduce usuario y contraseña.', 'warning');
            return;
        }

        try {
            setAuthLoading(true, action);
            setAuthStatusText(action === 'register' ? 'Creando usuario...' : 'Iniciando sesión...', 'muted');
            const response = action === 'register'
                ? await api.register(username, password)
                : await api.login(username, password);

            state.currentUser = response.username;
            persistAuthenticatedUser(response.username);
            elements.loginPasswordInput.value = '';
            await restoreAuthenticatedWorkspace();
        } catch (error) {
            console.error('Error de autenticación:', error);
            setAuthStatusText(error.message || 'No se pudo iniciar sesión.', 'warning');
        } finally {
            setAuthLoading(false, action);
        }
    }

    async function logout() {
        if (state.currentWorkout) {
            persistence.persistLocalDraft();
        }

        persistence.stopAutoSave();
        state.currentUser = null;
        clearPersistedAuthenticatedUser();

        try {
            await api.logout();
        } catch (error) {
            console.error('Error cerrando sesión:', error);
        }

        showAuthView('Sesión cerrada.', 'success');
    }

    async function restoreAuthSession() {
        try {
            const sessionData = await api.getSession();
            if (!sessionData.authenticated) {
                clearPersistedAuthenticatedUser();
                showAuthView();
                return;
            }

            state.currentUser = sessionData.username;
            persistAuthenticatedUser(sessionData.username);
            await restoreAuthenticatedWorkspace();
        } catch (error) {
            console.error('Error restaurando sesión:', error);
            showAuthView('No se pudo restaurar la sesión.', 'warning');
        }
    }

    // Nav tab switching is handled entirely by initNavDrag (pointer events)
    // to avoid double-fire between click and pointerup.
    elements.registerBtn.addEventListener('click', () => authenticate('register'));
    elements.logoutBtn.addEventListener('click', logout);
    elements.userMenuBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        toggleUserMenu();
    });
    elements.userMenuPopover.addEventListener('click', (event) => {
        event.stopPropagation();
    });
    elements.authForm.addEventListener('submit', (event) => {
        event.preventDefault();
        authenticate('login');
    });
    elements.togglePasswordBtn.addEventListener('click', () => {
        setPasswordVisibility(elements.loginPasswordInput.type === 'password');
    });
    elements.themeToggleBtn?.addEventListener('click', () => {
        toggleTheme();
    });

    window.addEventListener('beforeunload', () => {
        if (state.currentWorkout) {
            persistence.persistLocalDraft();
        }
    });

    window.addEventListener('pagehide', () => {
        if (!state.currentWorkout) {
            return;
        }

        persistence.persistLocalDraft();
        if (persistence.isIosDevice()) {
            persistence.saveDraftToServer(true);
        }
    });

    document.addEventListener('visibilitychange', () => {
        if (!state.currentWorkout || document.visibilityState !== 'hidden') {
            return;
        }

        persistence.persistLocalDraft();
        if (persistence.isIosDevice()) {
            persistence.saveDraftToServer(true);
        }
    });

    document.addEventListener('click', () => {
        closeUserMenu();
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            closeUserMenu();
        }
    });

    if (systemThemeMediaQuery) {
        const handleSystemThemeChange = () => {
            if (!getStoredThemePreference()) {
                applyTheme(getSystemTheme(), true);
            }
        };

        if (typeof systemThemeMediaQuery.addEventListener === 'function') {
            systemThemeMediaQuery.addEventListener('change', handleSystemThemeChange);
        } else if (typeof systemThemeMediaQuery.addListener === 'function') {
            systemThemeMediaQuery.addListener(handleSystemThemeChange);
        }
    }

    window.addEventListener('resize', () => updateNavHighlight());

    if (bootState?.username) {
        state.currentUser = bootState.username;
        state.activeTab = bootState.activeTab || state.activeTab;
    }

    syncThemeWithSystem();
    setPasswordVisibility(false);
    requestAnimationFrame(() => updateNavHighlight());
    restoreAuthSession();
}