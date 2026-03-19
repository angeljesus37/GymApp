async function fetchJson(url, options = {}) {
    const response = await fetch(url, {
        credentials: 'include',
        ...options
    });
    if (!response.ok) {
        let errorMessage = `Request failed: ${response.status}`;
        try {
            const payload = await response.json();
            if (payload?.message) {
                errorMessage = payload.message;
            }
        } catch (error) {
            // Ignore JSON parse errors and keep fallback message.
        }
        throw new Error(errorMessage);
    }
    return response.status === 204 ? null : response.json();
}

export const api = {
    getSession() {
        return fetchJson('/api/auth/session');
    },

    login(username, password) {
        return fetchJson('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
    },

    register(username, password) {
        return fetchJson('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
    },

    logout() {
        return fetchJson('/api/auth/logout', { method: 'POST' });
    },

    getDraft() {
        return fetchJson('/api/get_draft');
    },

    saveDraft(payload, keepalive = false) {
        return fetchJson('/api/save_draft', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            keepalive
        });
    },

    deleteDraft() {
        return fetchJson('/api/delete_draft', { method: 'DELETE' });
    },

    saveWorkout(payload) {
        return fetchJson('/api/save_workout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    },

    getLatestExercises(type) {
        return fetchJson(`/api/latest_exercises/${encodeURIComponent(type)}`);
    },

    getHistory(type = 'Todos', date = '', month = '') {
        let url = `/api/history?type=${encodeURIComponent(type)}`;
        if (date) {
            url += `&date=${encodeURIComponent(date)}`;
        }
        if (month) {
            url += `&month=${encodeURIComponent(month)}`;
        }
        return fetchJson(url);
    },

    getBodyWeight() {
        return fetchJson('/api/body_weight');
    },

    saveBodyWeight(payload) {
        return fetchJson('/api/body_weight', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    },

    getNutrition() {
        return fetchJson('/api/nutrition');
    },

    saveNutritionGoals(payload) {
        return fetchJson('/api/nutrition/goals', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    },

    saveNutritionEntry(payload) {
        return fetchJson('/api/nutrition/entry', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    },

    deleteNutritionEntry(entryId) {
        return fetchJson(`/api/nutrition/entry/${encodeURIComponent(entryId)}`, { method: 'DELETE' });
    },

    deleteWorkout(workoutId) {
        return fetchJson(`/api/delete_workout/${workoutId}`, { method: 'DELETE' });
    }
};