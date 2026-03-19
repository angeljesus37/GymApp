import { formatDurationSeconds, formatSetTag, hasSetData, isCardioType } from '../utils/normalizers.js';
import { getSelectedTypes } from '../state.js';

const STRENGTH_CHART_METRICS = {
    avgWeight: {
        label: 'Peso medio (kg)',
        type: 'line',
        borderColor: '#60a5fa',
        backgroundColor: 'rgba(96, 165, 250, 0.18)',
        format: (value) => `${Number(value || 0).toFixed(1)} kg`
    },
    maxWeight: {
        label: 'Peso maximo (kg)',
        type: 'line',
        borderColor: '#f59e0b',
        backgroundColor: 'rgba(245, 158, 11, 0.18)',
        format: (value) => `${Number(value || 0).toFixed(1)} kg`
    },
    totalReps: {
        label: 'Repeticiones totales',
        type: 'bar',
        borderColor: '#10b981',
        backgroundColor: 'rgba(16, 185, 129, 0.48)',
        format: (value) => `${Math.round(value || 0)} reps`
    },
    volume: {
        label: 'Volumen total',
        type: 'bar',
        borderColor: '#a78bfa',
        backgroundColor: 'rgba(167, 139, 250, 0.42)',
        format: (value) => `${Math.round(value || 0)} kg`
    }
};

const CARDIO_CHART_METRICS = {
    totalDurationSeconds: {
        label: 'Tiempo total',
        type: 'bar',
        borderColor: '#38bdf8',
        backgroundColor: 'rgba(56, 189, 248, 0.34)',
        format: (value) => formatDurationSeconds(value)
    },
    avgSpeed: {
        label: 'Velocidad media (km/h)',
        type: 'line',
        borderColor: '#f97316',
        backgroundColor: 'rgba(249, 115, 22, 0.2)',
        format: (value) => `${formatSpeed(value)} km/h`
    },
    maxSpeed: {
        label: 'Velocidad maxima (km/h)',
        type: 'line',
        borderColor: '#22c55e',
        backgroundColor: 'rgba(34, 197, 94, 0.2)',
        format: (value) => `${formatSpeed(value)} km/h`
    }
};

function formatSpeed(value) {
    if (!Number.isFinite(value)) {
        return '0';
    }

    return Number(value).toLocaleString('es-ES', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
    });
}

function getChartMetrics(exerciseType) {
    return isCardioType(exerciseType) ? CARDIO_CHART_METRICS : STRENGTH_CHART_METRICS;
}

function getDefaultChartMetric(exerciseType) {
    return Object.keys(getChartMetrics(exerciseType))[0];
}

function formatMonthSectionLabel(dateObj) {
    const label = dateObj.toLocaleString('es-ES', {
        month: 'long',
        year: 'numeric'
    });

    return label.charAt(0).toUpperCase() + label.slice(1);
}

function formatWeekdayBadge(dateObj) {
    return dateObj.toLocaleString('es-ES', { weekday: 'short' }).replace('.', '').toUpperCase();
}

export function createHistoryController({ elements, state, api, dialogs }) {
    const collapsedHistoryCards = new Set();
    let currentChartMetric = 'avgWeight';
    let currentChartContext = null;
    let areHistoryToolsCollapsed = false;

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function getSessionTypes(session) {
        return Array.isArray(session.types) ? session.types : session.type ? [session.type] : [];
    }

    function getValidSets(exercise) {
        return (exercise.sets || []).filter((set) => hasSetData(set, exercise.type));
    }

    function getExerciseMetrics(exercise) {
        const validSets = getValidSets(exercise);
        const completedSets = validSets.filter((set) => set.completed).length;

        if (isCardioType(exercise.type)) {
            const totalDurationSeconds = validSets.reduce((sum, set) => sum + (set.durationSeconds || 0), 0);
            const speedValues = validSets.map((set) => set.avgSpeed).filter(Number.isFinite);
            const speedTotal = speedValues.reduce((sum, speed) => sum + speed, 0);

            return {
                setCount: validSets.length,
                completedSets,
                totalReps: 0,
                maxWeight: 0,
                avgWeight: 0,
                volume: 0,
                totalDurationSeconds,
                avgSpeed: speedValues.length ? speedTotal / speedValues.length : 0,
                maxSpeed: speedValues.length ? Math.max(...speedValues) : 0
            };
        }

        const totalReps = validSets.reduce((sum, set) => sum + (set.reps || 0), 0);
        const maxWeight = validSets.reduce((max, set) => Math.max(max, set.weight || 0), 0);
        const totalWeight = validSets.reduce((sum, set) => sum + (set.weight || 0), 0);
        const volume = validSets.reduce((sum, set) => sum + ((set.reps || 0) * (set.weight || 0)), 0);

        return {
            setCount: validSets.length,
            completedSets,
            totalReps,
            maxWeight,
            avgWeight: validSets.length ? totalWeight / validSets.length : 0,
            volume,
            totalDurationSeconds: 0,
            avgSpeed: 0,
            maxSpeed: 0
        };
    }

    function getSessionMetrics(session) {
        return (session.exercises || []).reduce((accumulator, exercise) => {
            const metrics = getExerciseMetrics(exercise);
            accumulator.exerciseCount += 1;
            accumulator.setCount += metrics.setCount;
            accumulator.completedSets += metrics.completedSets;
            accumulator.totalReps += metrics.totalReps;
            accumulator.totalVolume += metrics.volume;
            accumulator.totalDurationSeconds += metrics.totalDurationSeconds;
            accumulator.maxWeight = Math.max(accumulator.maxWeight, metrics.maxWeight);
            accumulator.maxSpeed = Math.max(accumulator.maxSpeed, metrics.maxSpeed);
            return accumulator;
        }, {
            exerciseCount: 0,
            setCount: 0,
            completedSets: 0,
            totalReps: 0,
            totalVolume: 0,
            totalDurationSeconds: 0,
            maxWeight: 0,
            maxSpeed: 0
        });
    }

    function createSummaryPills(sessionMetrics) {
        const pills = [
            `<span class="history-summary-pill"><strong>${sessionMetrics.exerciseCount}</strong><span>ej.</span></span>`,
            `<span class="history-summary-pill"><strong>${sessionMetrics.setCount}</strong><span>ser.</span></span>`
        ];

        if (sessionMetrics.totalReps > 0) {
            pills.push(`<span class="history-summary-pill"><strong>${sessionMetrics.totalReps}</strong><span>reps</span></span>`);
        }

        if (sessionMetrics.totalDurationSeconds > 0) {
            pills.push(`<span class="history-summary-pill"><strong>${formatDurationSeconds(sessionMetrics.totalDurationSeconds)}</strong><span>tiempo</span></span>`);
        }

        if (sessionMetrics.totalVolume > 0) {
            pills.push(`<span class="history-summary-pill"><strong>${Math.round(sessionMetrics.totalVolume)}</strong><span>kg</span></span>`);
        }

        if (sessionMetrics.maxSpeed > 0) {
            pills.push(`<span class="history-summary-pill"><strong>${formatSpeed(sessionMetrics.maxSpeed)}</strong><span>km/h</span></span>`);
        }

        return `
            <div class="history-summary-pills">
                ${pills.join('')}
            </div>
        `;
    }

    function collectExerciseNames(history) {
        return Array.from(new Set(
            history
                .flatMap((session) => (session.exercises || []).map((exercise) => String(exercise.name || '').trim()))
                .filter(Boolean)
        )).sort((left, right) => left.localeCompare(right, 'es', { sensitivity: 'base' }));
    }

    function updateExerciseSuggestions(history) {
        if (!elements.historyExerciseOptions) {
            return;
        }

        elements.historyExerciseOptions.innerHTML = collectExerciseNames(history)
            .map((name) => `<option value="${escapeHtml(name)}"></option>`)
            .join('');
    }

    function filterHistoryByExercise(history, query) {
        const normalizedQuery = String(query || '').trim().toLowerCase();
        if (!normalizedQuery) {
            return history.map((session) => ({ ...session, filteredExercises: session.exercises || [] }));
        }

        return history
            .map((session) => {
                const filteredExercises = (session.exercises || []).filter((exercise) => exercise.name.toLowerCase().includes(normalizedQuery));
                return { ...session, filteredExercises };
            })
            .filter((session) => session.filteredExercises.length > 0);
    }

    function renderOverview(history) {
        if (!history.length) {
            elements.historyOverviewShell?.classList.add('hidden');
            elements.historyOverview.classList.add('hidden');
            elements.historyOverview.innerHTML = '';
            return;
        }

        const totals = history.reduce((accumulator, session) => {
            const metrics = getSessionMetrics({
                ...session,
                exercises: session.filteredExercises || session.exercises || []
            });
            accumulator.sessions += 1;
            accumulator.exercises += metrics.exerciseCount;
            accumulator.sets += metrics.setCount;
            accumulator.reps += metrics.totalReps;
            accumulator.volume += metrics.totalVolume;
            accumulator.durationSeconds += metrics.totalDurationSeconds;
            accumulator.maxSpeed = Math.max(accumulator.maxSpeed, metrics.maxSpeed);
            return accumulator;
        }, { sessions: 0, exercises: 0, sets: 0, reps: 0, volume: 0, durationSeconds: 0, maxSpeed: 0 });

        const overviewCards = [
            `
            <article class="history-overview-card">
                <span class="history-overview-label">Sesiones</span>
                <strong>${totals.sessions}</strong>
            </article>
            `,
            `
            <article class="history-overview-card">
                <span class="history-overview-label">Ejercicios</span>
                <strong>${totals.exercises}</strong>
            </article>
            `,
            `
            <article class="history-overview-card">
                <span class="history-overview-label">Series</span>
                <strong>${totals.sets}</strong>
            </article>
            `
        ];

        if (totals.reps > 0) {
            overviewCards.push(`
            <article class="history-overview-card">
                <span class="history-overview-label">Reps</span>
                <strong>${totals.reps}</strong>
            </article>
            `);
        }

        if (totals.durationSeconds > 0) {
            overviewCards.push(`
            <article class="history-overview-card">
                <span class="history-overview-label">Tiempo total</span>
                <strong>${formatDurationSeconds(totals.durationSeconds)}</strong>
            </article>
            `);
        }

        if (totals.volume > 0) {
            overviewCards.push(`
            <article class="history-overview-card history-overview-card-wide">
                <span class="history-overview-label">Volumen total</span>
                <strong>${Math.round(totals.volume)} kg</strong>
            </article>
            `);
        }

        if (totals.maxSpeed > 0) {
            overviewCards.push(`
            <article class="history-overview-card history-overview-card-wide">
                <span class="history-overview-label">Pico de velocidad</span>
                <strong>${formatSpeed(totals.maxSpeed)} km/h</strong>
            </article>
            `);
        }

        elements.historyOverviewShell?.classList.remove('hidden');
        elements.historyOverview.classList.remove('hidden');
        elements.historyOverview.innerHTML = overviewCards.join('');
    }

    function getExerciseMetaText(exercise, metrics) {
        if (isCardioType(exercise.type)) {
            return `${metrics.setCount} series · ${formatDurationSeconds(metrics.totalDurationSeconds)} · ${formatSpeed(metrics.avgSpeed)} km/h`;
        }

        return `${metrics.setCount} series · ${metrics.totalReps} reps · ${Math.round(metrics.volume)} kg`;
    }

    function getExerciseGroupLabel(type) {
        return type && type !== 'Sin Grupo' ? type : 'Otros ejercicios';
    }

    function groupExercisesForHistory(session, exercises) {
        const sessionTypes = getSessionTypes(session);
        const orderedTypes = [];

        sessionTypes.forEach((type) => {
            const normalized = String(type || '').trim() || 'Sin Grupo';
            if (!orderedTypes.includes(normalized)) {
                orderedTypes.push(normalized);
            }
        });

        exercises.forEach((exercise) => {
            const type = String(exercise.type || '').trim() || 'Sin Grupo';
            if (!orderedTypes.includes(type)) {
                orderedTypes.push(type);
            }
        });

        return orderedTypes
            .map((type) => ({
                type,
                exercises: exercises.filter((exercise) => (String(exercise.type || '').trim() || 'Sin Grupo') === type)
            }))
            .filter((group) => group.exercises.length > 0);
    }

    function toggleHistoryCard(button) {
        const card = button.closest('.history-card');
        const sessionId = card?.dataset.sessionId;
        if (!sessionId) {
            return;
        }

        card.classList.toggle('collapsed');
        const isCollapsed = card.classList.contains('collapsed');
        card.querySelectorAll('.history-card-toggle, .history-collapse-btn').forEach((toggleButton) => {
            toggleButton.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
            if (toggleButton.classList.contains('history-collapse-btn')) {
                toggleButton.setAttribute('aria-label', isCollapsed ? 'Expandir entrenamiento' : 'Plegar entrenamiento');
            }
        });
        if (isCollapsed) {
            collapsedHistoryCards.add(sessionId);
        } else {
            collapsedHistoryCards.delete(sessionId);
        }
    }

    function attachHistoryInteractions(container) {
        container.querySelectorAll('.history-card-toggle, .history-collapse-btn').forEach((button) => {
            if (button.dataset.bound === 'true') {
                return;
            }

            button.dataset.bound = 'true';
            button.addEventListener('click', () => {
                toggleHistoryCard(button);
            });
        });

        container.querySelectorAll('.delete-workout-btn').forEach((button) => {
            if (button.dataset.bound === 'true') {
                return;
            }

            button.dataset.bound = 'true';
            button.addEventListener('click', async (event) => {
                event.stopPropagation();
                await deleteWorkout(button.dataset.workoutId);
            });
        });

        container.querySelectorAll('.evolution-btn').forEach((button) => {
            if (button.dataset.bound === 'true') {
                return;
            }

            button.dataset.bound = 'true';
            button.addEventListener('click', () => {
                const exerciseName = decodeURIComponent(button.dataset.exercise || '');
                const type = button.dataset.type || elements.historyFilterType.value;
                openExerciseChart(exerciseName, type);
            });
        });
    }

    function renderHistoryList(history, container) {
        if (!history.length) {
            container.innerHTML = '<div class="empty-state"><p>No se encontraron entrenamientos.</p></div>';
            if (container === elements.fullHistoryContainer) {
                renderOverview([]);
            }
            return;
        }

        if (container === elements.fullHistoryContainer) {
            renderOverview(history);
        }

        const historyByMonth = history.reduce((accumulator, session) => {
            const [yearStr, monthStr] = String(session.date || '').split('-');
            const monthKey = yearStr && monthStr ? `${yearStr}-${monthStr}` : 'sin-fecha';
            if (!accumulator[monthKey]) {
                accumulator[monthKey] = [];
            }

            accumulator[monthKey].push(session);
            return accumulator;
        }, {});

        container.innerHTML = Object.entries(historyByMonth).map(([monthKey, sessions]) => {
            const [yearStr, monthStr] = monthKey.split('-');
            const monthDate = yearStr && monthStr ? new Date(Number(yearStr), Number(monthStr) - 1, 1) : null;
            const monthHeading = monthDate ? formatMonthSectionLabel(monthDate) : 'Sin fecha';
            const sessionsHtml = sessions.map((session) => {
            const [yearStr, monthStr, dayStr] = session.date.split('-');
            const dateObj = new Date(yearStr, monthStr - 1, dayStr);
            const weekdayBadge = formatWeekdayBadge(dateObj);
            const sessionTypes = getSessionTypes(session);
            const primaryType = sessionTypes[0] || 'Todos';
            const visibleExercises = session.filteredExercises || session.exercises || [];
            const sessionMetrics = getSessionMetrics({ ...session, exercises: visibleExercises });
            const isCollapsed = collapsedHistoryCards.has(session.id);
            const exercisesListHtml = groupExercisesForHistory(session, visibleExercises).map((group) => {
                const exercisesHtml = group.exercises.map((exercise) => {
                    return `
                        <div class="history-exercise-item">
                            <div class="history-exercise-head">
                                <div>
                                    <h4>${escapeHtml(exercise.name)}</h4>
                                </div>
                                <button class="evolution-btn" data-exercise="${encodeURIComponent(exercise.name)}" data-type="${escapeHtml(exercise.type || primaryType)}">Evolucion</button>
                            </div>
                            <div class="history-sets">${(exercise.sets || []).map((set) => `<span class="set-tag">${formatSetTag({ ...set, type: exercise.type })}</span>`).join('')}</div>
                        </div>
                    `;
                }).join('');

                return `
                    <section class="history-exercise-group">
                        <header class="history-exercise-group-header">
                            <span class="history-exercise-group-label">${escapeHtml(getExerciseGroupLabel(group.type))}</span>
                        </header>
                        <div class="history-exercise-group-body">
                            ${exercisesHtml}
                        </div>
                    </section>
                `;
            }).join('');

            return `
                <article class="history-card ${isCollapsed ? 'collapsed' : ''}" data-session-id="${escapeHtml(session.id)}">
                    <div class="history-header">
                        <button class="history-card-toggle" type="button" aria-expanded="${isCollapsed ? 'false' : 'true'}">
                            <div class="history-date-badge">
                                <span class="date-day">${dayStr}</span>
                                <span class="date-month">${weekdayBadge}</span>
                            </div>
                            <div class="history-meta">
                                <h3>${escapeHtml(sessionTypes.join(', ') || 'Sin grupo')}</h3>
                                ${createSummaryPills(sessionMetrics)}
                            </div>
                        </button>
                        <div class="history-header-actions">
                            <button class="history-collapse-btn" type="button" aria-label="${isCollapsed ? 'Expandir entrenamiento' : 'Plegar entrenamiento'}" aria-expanded="${isCollapsed ? 'false' : 'true'}"></button>
                            <button class="delete-workout-btn" type="button" data-workout-id="${escapeHtml(session.id)}" title="Eliminar entrenamiento">&times;</button>
                        </div>
                    </div>
                    <div class="history-body">
                        ${exercisesListHtml || '<p>Sin ejercicios</p>'}
                    </div>
                </article>
            `;
            }).join('');

            return `
                <div class="history-month-group">
                    <h3 class="history-month-title">${escapeHtml(monthHeading)}</h3>
                    ${sessionsHtml}
                </div>
            `;
        }).join('');

        attachHistoryInteractions(container);
    }

    async function deleteWorkout(workoutId) {
        const confirmed = await dialogs.confirm('Eliminar entrenamiento', '¿Seguro que quieres eliminar este entrenamiento permanentemente?');
        if (!confirmed) {
            return;
        }

        try {
            await dialogs.withLoading('Eliminando entrenamiento...', async () => {
                await api.deleteWorkout(workoutId);
            });
            collapsedHistoryCards.delete(workoutId);
            if (elements.historyView.classList.contains('hidden')) {
                await showHistory();
            } else {
                await loadFullHistory();
            }
        } catch (error) {
            console.error('Error eliminando entrenamiento:', error);
            await dialogs.alert('Error', 'No se pudo eliminar el entrenamiento.');
        }
    }

    function buildExerciseChartPoints(history, exerciseName, exerciseType) {
        const points = [];

        history.forEach((session) => {
            const exercise = (session.exercises || []).find((item) => item.name === exerciseName && (!exerciseType || exerciseType === 'Todos' || item.type === exerciseType));
            if (!exercise) {
                return;
            }

            const metrics = getExerciseMetrics(exercise);
            if (!metrics.setCount) {
                return;
            }

            points.push({ date: session.date, ...metrics });
        });

        points.sort((left, right) => left.date.localeCompare(right.date));
        return points;
    }

    function renderChartMetricTabs(exerciseType) {
        const metrics = getChartMetrics(exerciseType);
        elements.chartMetricTabs.innerHTML = Object.entries(metrics).map(([metricKey, metric], index) => `
            <button type="button" class="chart-metric-btn ${index === 0 ? 'active' : ''}" data-metric="${metricKey}">${metric.label}</button>
        `).join('');
    }

    function renderChartStats(points, metricKey) {
        if (!points.length) {
            elements.chartStatGrid.innerHTML = '<div class="empty-state"><p>No hay datos suficientes para este ejercicio.</p></div>';
            return;
        }

        const latestPoint = points[points.length - 1];
        const metric = getChartMetrics(currentChartContext?.type)[metricKey];
        const bestValue = Math.max(...points.map((point) => point[metricKey] || 0));

        elements.chartStatGrid.innerHTML = `
            <article class="chart-stat-card">
                <span class="chart-stat-label">Sesiones</span>
                <strong>${points.length}</strong>
            </article>
            <article class="chart-stat-card">
                <span class="chart-stat-label">Ultimo registro</span>
                <strong>${metric.format(latestPoint[metricKey])}</strong>
            </article>
            <article class="chart-stat-card">
                <span class="chart-stat-label">Mejor marca</span>
                <strong>${metric.format(bestValue)}</strong>
            </article>
            <article class="chart-stat-card">
                <span class="chart-stat-label">Ultima fecha</span>
                <strong>${latestPoint.date}</strong>
            </article>
        `;
    }

    function toChartNumber(value) {
        return Number.isFinite(value) ? Number(value.toFixed(2)) : 0;
    }

    function renderActiveChartMetric() {
        if (!currentChartContext) {
            return;
        }

        const metric = getChartMetrics(currentChartContext.type)[currentChartMetric];
        const points = currentChartContext.points;
        renderChartStats(points, currentChartMetric);

        if (state.currentChart) {
            state.currentChart.destroy();
            state.currentChart = null;
        }

        if (!points.length) {
            return;
        }

        state.currentChart = new Chart(elements.chartCanvas.getContext('2d'), {
            type: metric.type,
            data: {
                labels: points.map((point) => point.date),
                datasets: [
                    {
                        label: metric.label,
                        data: points.map((point) => toChartNumber(point[currentChartMetric] || 0)),
                        borderColor: metric.borderColor,
                        backgroundColor: metric.backgroundColor,
                        fill: metric.type === 'line',
                        borderWidth: 2,
                        tension: 0.32
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: {
                        display: true,
                        labels: { color: '#cbd5e1' }
                    }
                },
                scales: {
                    x: {
                        ticks: { color: '#94a3b8' },
                        grid: { color: 'rgba(148, 163, 184, 0.12)' }
                    },
                    y: {
                        ticks: { color: '#94a3b8' },
                        grid: { color: 'rgba(148, 163, 184, 0.12)' }
                    }
                }
            }
        });

        elements.chartMetricTabs.querySelectorAll('.chart-metric-btn').forEach((button) => {
            button.classList.toggle('active', button.dataset.metric === currentChartMetric);
        });
    }

    async function openExerciseChart(exerciseName, type) {
        try {
            const history = await api.getHistory(type && type !== 'Todos' ? type : 'Todos');
            const exerciseType = type || 'Todos';
            const points = buildExerciseChartPoints(history, exerciseName, exerciseType);
            renderChartMetricTabs(exerciseType);
            const defaultMetric = getDefaultChartMetric(exerciseType);
            currentChartMetric = getChartMetrics(exerciseType)[currentChartMetric] ? currentChartMetric : defaultMetric;
            currentChartContext = { exerciseName, type: exerciseType, points };
            elements.chartTitle.textContent = `Evolucion: ${exerciseName}`;
            elements.chartSubtitle.textContent = points.length
                ? `${points.length} sesiones registradas · ${type === 'Todos' ? 'Todos los grupos' : type}`
                : 'Sin datos suficientes';
            elements.chartModal.classList.remove('hidden');
            renderActiveChartMetric();
        } catch (error) {
            console.error('Error generando grafica:', error);
            await dialogs.alert('Error', 'No se pudo generar la grafica.');
        }
    }

    function updateHistoryToolsVisibility() {
        if (!elements.historyToolsPanel || !elements.toggleHistoryToolsBtn) {
            return;
        }

        elements.historyToolsPanel.classList.toggle('collapsed', areHistoryToolsCollapsed);
        elements.toggleHistoryToolsBtn.textContent = areHistoryToolsCollapsed ? 'Mostrar filtros' : 'Ocultar filtros';
        elements.toggleHistoryToolsBtn.setAttribute('aria-expanded', areHistoryToolsCollapsed ? 'false' : 'true');
    }

    async function showHistory() {
        const types = getSelectedTypes(state);
        elements.historyMuscleGroup.textContent = types.join(', ') || 'Todos los grupos';
        elements.historyContainer.innerHTML = 'Cargando...';
        elements.historyModal.classList.remove('hidden');

        try {
            const history = await api.getHistory('Todos');
            const filteredHistory = types.length
                ? history.filter((session) => {
                    const sessionTypes = getSessionTypes(session);
                    return types.some((type) => sessionTypes.includes(type));
                })
                : history;
            renderHistoryList(filterHistoryByExercise(filteredHistory, elements.historyFilterExercise.value), elements.historyContainer);
        } catch (error) {
            console.error('Error cargando historial:', error);
            elements.historyContainer.innerHTML = '<p>No se pudo cargar el historial.</p>';
        }
    }

    async function loadFullHistory() {
        elements.fullHistoryContainer.innerHTML = 'Cargando...';

        try {
            const history = await api.getHistory(
                elements.historyFilterType.value,
                elements.historyFilterDate.value,
                elements.historyFilterMonth.value
            );
            updateExerciseSuggestions(history);
            const filteredHistory = filterHistoryByExercise(history, elements.historyFilterExercise.value);
            renderHistoryList(filteredHistory, elements.fullHistoryContainer);
        } catch (error) {
            console.error('Error cargando historial completo:', error);
            elements.fullHistoryContainer.innerHTML = '<p>Error al cargar el historial.</p>';
            renderOverview([]);
        }
    }

    function clearFilters() {
        elements.historyFilterType.value = 'Todos';
        elements.historyFilterDate.value = '';
        elements.historyFilterMonth.value = '';
        elements.historyFilterExercise.value = '';
        loadFullHistory();
    }

    function handleExactDateChange() {
        if (elements.historyFilterDate.value) {
            elements.historyFilterMonth.value = '';
        }

        loadFullHistory();
    }

    function handleMonthChange() {
        if (elements.historyFilterMonth.value) {
            elements.historyFilterDate.value = '';
        }

        loadFullHistory();
    }

    function closeChart() {
        elements.chartModal.classList.add('hidden');
        elements.chartSubtitle.textContent = '';
        elements.chartStatGrid.innerHTML = '';
        currentChartContext = null;
        if (state.currentChart) {
            state.currentChart.destroy();
            state.currentChart = null;
        }
    }

    function init() {
        elements.applyFiltersBtn.addEventListener('click', loadFullHistory);
        elements.clearFiltersBtn?.addEventListener('click', clearFilters);
        elements.toggleHistoryToolsBtn?.addEventListener('click', () => {
            areHistoryToolsCollapsed = !areHistoryToolsCollapsed;
            updateHistoryToolsVisibility();
        });
        elements.historyFilterExercise?.addEventListener('input', loadFullHistory);
        elements.historyFilterType?.addEventListener('change', loadFullHistory);
        elements.historyFilterDate?.addEventListener('change', handleExactDateChange);
        elements.historyFilterMonth?.addEventListener('change', handleMonthChange);
        elements.closeModalBtn?.addEventListener('click', () => elements.historyModal.classList.add('hidden'));
        elements.closeChartBtn?.addEventListener('click', closeChart);
        elements.chartMetricTabs?.addEventListener('click', (event) => {
            const button = event.target.closest('.chart-metric-btn');
            if (!button) {
                return;
            }

            currentChartMetric = button.dataset.metric;
            renderActiveChartMetric();
        });

        elements.historyModal.addEventListener('click', (event) => {
            if (event.target === elements.historyModal) {
                elements.historyModal.classList.add('hidden');
            }
        });

        elements.chartModal.addEventListener('click', (event) => {
            if (event.target === elements.chartModal) {
                closeChart();
            }
        });

        updateHistoryToolsVisibility();
    }

    return {
        init,
        showHistory,
        loadFullHistory,
        clearFilters
    };
}
