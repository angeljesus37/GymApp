function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function parseDate(value) {
    if (!value) {
        return null;
    }

    const [year, month, day] = String(value).split('-').map((item) => parseInt(item, 10));
    if (!year || !month || !day) {
        return null;
    }

    return new Date(year, month - 1, day);
}

function toIsoDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function startOfWeek(date) {
    const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const day = copy.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    copy.setDate(copy.getDate() + diff);
    copy.setHours(0, 0, 0, 0);
    return copy;
}

function addDays(date, amount) {
    const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    copy.setDate(copy.getDate() + amount);
    return copy;
}

function getWorkoutMetrics(workout) {
    return (workout.exercises || []).reduce((accumulator, exercise) => {
        const validSets = (exercise.sets || []).filter((set) => set.reps !== null || set.weight !== null);
        accumulator.exercises += 1;
        accumulator.sets += validSets.length;
        accumulator.reps += validSets.reduce((sum, set) => sum + (set.reps || 0), 0);
        accumulator.volume += validSets.reduce((sum, set) => sum + ((set.reps || 0) * (set.weight || 0)), 0);
        return accumulator;
    }, {
        sessions: 1,
        exercises: 0,
        sets: 0,
        reps: 0,
        volume: 0,
        activeDays: 1
    });
}

function sumMetrics(workouts) {
    const dayKeys = new Set();
    const totals = workouts.reduce((accumulator, workout) => {
        const metrics = getWorkoutMetrics(workout);
        accumulator.sessions += metrics.sessions;
        accumulator.exercises += metrics.exercises;
        accumulator.sets += metrics.sets;
        accumulator.reps += metrics.reps;
        accumulator.volume += metrics.volume;
        if (workout.date) {
            dayKeys.add(workout.date);
        }
        return accumulator;
    }, {
        sessions: 0,
        exercises: 0,
        sets: 0,
        reps: 0,
        volume: 0,
        activeDays: 0
    });

    totals.activeDays = dayKeys.size;
    return totals;
}

function getMonthRange(cursor) {
    const start = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const end = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    return { start, end };
}

function isBetween(dateValue, start, end) {
    return dateValue >= start && dateValue <= end;
}

function groupWorkoutsByDate(workouts) {
    return workouts.reduce((accumulator, workout) => {
        if (!workout.date) {
            return accumulator;
        }

        if (!accumulator[workout.date]) {
            accumulator[workout.date] = [];
        }
        accumulator[workout.date].push(workout);
        return accumulator;
    }, {});
}

function getWeightTrend(entries) {
    if (!entries.length) {
        return { latest: null, earliest: null, delta: null };
    }

    const sorted = [...entries].sort((left, right) => left.date.localeCompare(right.date));
    const earliest = sorted[0];
    const latest = sorted[sorted.length - 1];
    return {
        latest,
        earliest,
        delta: latest && earliest ? Number((latest.weight - earliest.weight).toFixed(1)) : null
    };
}

function formatShortDate(value) {
    const date = value instanceof Date ? value : new Date(value);
    return date.toLocaleDateString('es-ES', {
        day: '2-digit',
        month: '2-digit'
    });
}

export function createProgressController({ elements, state, api, dialogs }) {
    let allWorkouts = [];
    let bodyWeightEntries = [];

    function ensureMonthCursor() {
        if (!state.progressMonthCursor) {
            state.progressMonthCursor = new Date();
        }
    }

    function renderSummaryCards() {
        ensureMonthCursor();
        const today = new Date();
        const weekStart = startOfWeek(today);
        const weekEnd = addDays(weekStart, 6);
        const monthRange = getMonthRange(state.progressMonthCursor);

        const weeklyWorkouts = allWorkouts.filter((workout) => {
            const date = parseDate(workout.date);
            return date && isBetween(date, weekStart, weekEnd);
        });
        const monthlyWorkouts = allWorkouts.filter((workout) => {
            const date = parseDate(workout.date);
            return date && isBetween(date, monthRange.start, monthRange.end);
        });

        const weekly = sumMetrics(weeklyWorkouts);
        const monthly = sumMetrics(monthlyWorkouts);
        const weightTrend = getWeightTrend(bodyWeightEntries);

        elements.progressSummaryGrid.innerHTML = `
            <article class="progress-summary-card">
                <span class="progress-summary-kicker">Semana actual</span>
                <strong>${weekly.sessions}</strong>
                <p>${weekly.activeDays} dias activos · ${weekly.sets} series · ${Math.round(weekly.volume)} kg</p>
            </article>
            <article class="progress-summary-card">
                <span class="progress-summary-kicker">Mes visible</span>
                <strong>${monthly.sessions}</strong>
                <p>${monthly.activeDays} dias activos · ${monthly.reps} reps · ${Math.round(monthly.volume)} kg</p>
            </article>
            <article class="progress-summary-card">
                <span class="progress-summary-kicker">Peso actual</span>
                <strong>${weightTrend.latest ? `${weightTrend.latest.weight.toFixed(1)} kg` : '--'}</strong>
                <p>${weightTrend.latest ? `Ultimo registro ${weightTrend.latest.date}` : 'Sin registros'}</p>
            </article>
            <article class="progress-summary-card">
                <span class="progress-summary-kicker">Cambio total</span>
                <strong>${weightTrend.delta === null ? '--' : `${weightTrend.delta > 0 ? '+' : ''}${weightTrend.delta.toFixed(1)} kg`}</strong>
                <p>${bodyWeightEntries.length ? `${bodyWeightEntries.length} registros de peso` : 'Empieza registrando tu peso'}</p>
            </article>
        `;
    }

    function renderCalendar() {
        ensureMonthCursor();
        const { start, end } = getMonthRange(state.progressMonthCursor);
        const monthLabel = state.progressMonthCursor.toLocaleString('es-ES', {
            month: 'long',
            year: 'numeric'
        });
        elements.progressMonthLabel.textContent = monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1);

        const workoutsByDate = groupWorkoutsByDate(allWorkouts);
        const firstWeekday = (start.getDay() + 6) % 7;
        const totalDays = end.getDate();
        const cells = [];
        const todayKey = toIsoDate(new Date());

        for (let index = 0; index < firstWeekday; index += 1) {
            cells.push('<div class="progress-calendar-cell is-empty" aria-hidden="true"></div>');
        }

        for (let day = 1; day <= totalDays; day += 1) {
            const current = new Date(start.getFullYear(), start.getMonth(), day);
            const key = toIsoDate(current);
            const dayWorkouts = workoutsByDate[key] || [];
            const intensity = Math.min(dayWorkouts.length, 3);
            const totalVolume = Math.round(dayWorkouts.reduce((sum, workout) => sum + getWorkoutMetrics(workout).volume, 0));
            cells.push(`
                <div class="progress-calendar-cell ${dayWorkouts.length ? `is-active level-${intensity}` : ''} ${key === todayKey ? 'is-today' : ''}">
                    <span class="calendar-day-number">${day}</span>
                    <span class="calendar-day-meta">${dayWorkouts.length ? `${dayWorkouts.length} ses.` : ''}</span>
                    <span class="calendar-day-volume">${dayWorkouts.length ? `${totalVolume} kg` : ''}</span>
                </div>
            `);
        }

        elements.progressCalendarGrid.innerHTML = cells.join('');
    }

    function renderWeightSummary() {
        if (!bodyWeightEntries.length) {
            elements.bodyWeightStatus.textContent = 'Sin registros todavía.';
            elements.bodyWeightSummary.innerHTML = '<div class="empty-state"><p>Añade tu peso para ver la evolución.</p></div>';
            elements.bodyWeightHistory.innerHTML = '';
            return;
        }

        const sorted = [...bodyWeightEntries].sort((left, right) => right.date.localeCompare(left.date));
        const latest = sorted[0];
        const oldest = sorted[sorted.length - 1];
        const delta = Number((latest.weight - oldest.weight).toFixed(1));
        const average = sorted.reduce((sum, entry) => sum + entry.weight, 0) / sorted.length;
        elements.bodyWeightStatus.textContent = `${sorted.length} registros · ultimo ${latest.date}`;
        elements.bodyWeightSummary.innerHTML = `
            <article class="weight-summary-card">
                <span class="progress-summary-kicker">Ultimo</span>
                <strong>${latest.weight.toFixed(1)} kg</strong>
            </article>
            <article class="weight-summary-card">
                <span class="progress-summary-kicker">Promedio</span>
                <strong>${average.toFixed(1)} kg</strong>
            </article>
            <article class="weight-summary-card">
                <span class="progress-summary-kicker">Cambio</span>
                <strong>${delta > 0 ? '+' : ''}${delta.toFixed(1)} kg</strong>
            </article>
        `;
        elements.bodyWeightHistory.innerHTML = sorted.slice(0, 8).map((entry) => `
            <div class="body-weight-history-item">
                <span>${entry.date}</span>
                <strong>${entry.weight.toFixed(1)} kg</strong>
            </div>
        `).join('');
    }

    function renderWeightChart() {
        if (state.currentWeightChart) {
            state.currentWeightChart.destroy();
            state.currentWeightChart = null;
        }

        if (!bodyWeightEntries.length) {
            return;
        }

        const sorted = [...bodyWeightEntries].sort((left, right) => left.date.localeCompare(right.date));
        const labels = sorted.map((entry) => formatShortDate(parseDate(entry.date)));
        const values = sorted.map((entry) => Number(entry.weight.toFixed(2)));
        const dateLabels = sorted.map((entry) => entry.date);

        state.currentWeightChart = new Chart(elements.bodyWeightChart.getContext('2d'), {
            type: 'line',
            data: {
                labels,
                datasets: [
                    {
                        label: 'Peso corporal',
                        data: values,
                        borderColor: '#34d399',
                        backgroundColor: 'rgba(52, 211, 153, 0.18)',
                        borderWidth: 2,
                        fill: true,
                        tension: 0.28,
                        pointRadius: 2.5,
                        pointHoverRadius: 2.5,
                        pointHitRadius: 18,
                        pointHoverBorderWidth: 0
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'nearest',
                    axis: 'x',
                    intersect: false
                },
                plugins: {
                    legend: {
                        labels: { color: '#cbd5e1' }
                    },
                    tooltip: {
                        callbacks: {
                            title(items) {
                                const firstItem = items[0];
                                return dateLabels[firstItem?.dataIndex ?? -1] || '';
                            },
                            label(context) {
                                return `Peso: ${Number(context.parsed?.y ?? context.raw ?? 0).toFixed(1)} kg`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        ticks: {
                            color: '#94a3b8',
                            maxTicksLimit: 5
                        },
                        grid: { color: 'rgba(148, 163, 184, 0.12)' }
                    },
                    y: {
                        ticks: { color: '#94a3b8' },
                        grid: { color: 'rgba(148, 163, 184, 0.12)' }
                    }
                }
            }
        });
    }

    function renderProgress() {
        renderSummaryCards();
        renderCalendar();
        renderWeightSummary();
        renderWeightChart();
    }

    async function loadProgress() {
        try {
            const [history, weightEntries] = await Promise.all([
                api.getHistory('Todos'),
                api.getBodyWeight()
            ]);
            allWorkouts = Array.isArray(history) ? history : [];
            bodyWeightEntries = Array.isArray(weightEntries) ? weightEntries.map((entry) => ({
                date: String(entry.date),
                weight: Number(entry.weight)
            })).filter((entry) => entry.date && Number.isFinite(entry.weight)) : [];
            renderProgress();
        } catch (error) {
            console.error('Error cargando progreso:', error);
            elements.progressSummaryGrid.innerHTML = '<div class="empty-state"><p>No se pudo cargar la pantalla de progreso.</p></div>';
            elements.progressCalendarGrid.innerHTML = '';
            elements.bodyWeightSummary.innerHTML = '';
            elements.bodyWeightHistory.innerHTML = '';
        }
    }

    async function saveBodyWeight() {
        const date = elements.bodyWeightDateInput.value;
        const weight = Number.parseFloat(String(elements.bodyWeightInput.value || '').replace(',', '.'));

        if (!date || !Number.isFinite(weight) || weight <= 0) {
            await dialogs.alert('Peso corporal', 'Introduce una fecha valida y un peso mayor que cero.');
            return;
        }

        try {
            elements.saveBodyWeightBtn.disabled = true;
            elements.saveBodyWeightBtn.textContent = 'Guardando...';
            await api.saveBodyWeight({ date, weight });
            elements.bodyWeightInput.value = '';
            await loadProgress();
        } catch (error) {
            console.error('Error guardando peso corporal:', error);
            await dialogs.alert('Peso corporal', error.message || 'No se pudo guardar el peso.');
        } finally {
            elements.saveBodyWeightBtn.disabled = false;
            elements.saveBodyWeightBtn.textContent = 'Guardar peso';
        }
    }

    function changeMonth(offset) {
        ensureMonthCursor();
        state.progressMonthCursor = new Date(state.progressMonthCursor.getFullYear(), state.progressMonthCursor.getMonth() + offset, 1);
        renderSummaryCards();
        renderCalendar();
    }

    function init() {
        ensureMonthCursor();
        elements.bodyWeightDateInput.value = toIsoDate(new Date());
        elements.saveBodyWeightBtn?.addEventListener('click', saveBodyWeight);
        elements.bodyWeightInput?.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                saveBodyWeight();
            }
        });
        elements.progressPrevMonthBtn?.addEventListener('click', () => changeMonth(-1));
        elements.progressNextMonthBtn?.addEventListener('click', () => changeMonth(1));
    }

    return {
        init,
        loadProgress
    };
}
