import { buildDraftPayload, normalizeWorkoutData } from '../utils/normalizers.js';
import { getSelectedTypes } from '../state.js';

function testStorageAvailability() {
    try {
        const testKey = '__training_app_test__';
        window.localStorage.setItem(testKey, testKey);
        window.localStorage.removeItem(testKey);
        return true;
    } catch (error) {
        return false;
    }
}

function isIosDevice() {
    const userAgent = navigator.userAgent || navigator.vendor || '';
    const isTouchMac = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
    return /iPhone|iPad|iPod/.test(userAgent) || isTouchMac;
}

export function createPersistenceService({
    state,
    api,
    getStorageKey,
    localSaveInterval,
    serverSaveInterval,
    setSaveStatusText
}) {
    const storageAvailable = testStorageAvailability();

    function safeSetItem(key, value) {
        if (storageAvailable) {
            window.localStorage.setItem(key, value);
            return;
        }

        state.inMemoryStorage[key] = value;
    }

    function safeGetItem(key) {
        if (storageAvailable) {
            return window.localStorage.getItem(key);
        }

        return state.inMemoryStorage[key] || null;
    }

    function safeRemoveItem(key) {
        if (storageAvailable) {
            window.localStorage.removeItem(key);
            return;
        }

        delete state.inMemoryStorage[key];
    }

    function persistLocalDraft() {
        const storageKey = getStorageKey();
        if (!storageKey) {
            return;
        }

        const payload = buildDraftPayload(state.currentWorkout, getSelectedTypes(state));
        if (!payload) {
            safeRemoveItem(storageKey);
            return;
        }

        safeSetItem(storageKey, JSON.stringify(payload));
    }

    function clearPersistedDraft() {
        const storageKey = getStorageKey();
        if (!storageKey) {
            return;
        }

        safeRemoveItem(storageKey);
    }

    async function saveDraftToServer(force = false) {
        if (!state.currentWorkout || state.isSavingToServer || (!state.draftDirty && !force)) {
            return;
        }

        const payload = buildDraftPayload(state.currentWorkout, getSelectedTypes(state));
        if (!payload) {
            return;
        }

        state.isSavingToServer = true;
        try {
            await api.saveDraft(payload, force);
            state.draftDirty = false;
            setSaveStatusText('', 'success');
        } catch (error) {
            console.error('Error guardando borrador en servidor:', error);
            setSaveStatusText('Borrador local', 'warning');
        } finally {
            state.isSavingToServer = false;
        }
    }

    function markWorkoutDirty() {
        if (!state.currentWorkout) {
            return;
        }

        state.draftDirty = true;
        persistLocalDraft();
        setSaveStatusText('', 'muted');
    }

    function startAutoSave() {
        stopAutoSave();

        state.localAutoSaveTimer = window.setInterval(() => {
            if (!state.currentWorkout || !state.draftDirty) {
                return;
            }

            persistLocalDraft();
            setSaveStatusText('', 'success');
        }, localSaveInterval);

        state.serverAutoSaveTimer = window.setInterval(() => {
            if (!state.currentWorkout) {
                return;
            }

            saveDraftToServer();
        }, serverSaveInterval);
    }

    function stopAutoSave() {
        if (state.localAutoSaveTimer) {
            window.clearInterval(state.localAutoSaveTimer);
            state.localAutoSaveTimer = null;
        }

        if (state.serverAutoSaveTimer) {
            window.clearInterval(state.serverAutoSaveTimer);
            state.serverAutoSaveTimer = null;
        }
    }

    async function restoreSession() {
        const storageKey = getStorageKey();
        let restoredWorkout = null;

        if (storageKey) {
            try {
                const localDraft = safeGetItem(storageKey);
                if (localDraft) {
                    restoredWorkout = normalizeWorkoutData(JSON.parse(localDraft));
                }
            } catch (error) {
                console.error('Error restaurando borrador local:', error);
            }
        }

        if (!restoredWorkout) {
            try {
                const serverDraft = await api.getDraft();
                restoredWorkout = normalizeWorkoutData(serverDraft);
            } catch (error) {
                console.error('Error restaurando borrador del servidor:', error);
            }
        }

        return restoredWorkout;
    }

    return {
        isIosDevice,
        persistLocalDraft,
        clearPersistedDraft,
        saveDraftToServer,
        markWorkoutDirty,
        startAutoSave,
        stopAutoSave,
        restoreSession
    };
}