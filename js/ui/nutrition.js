function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function toIsoDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function parseNumericInput(value) {
    const normalized = String(value ?? '').trim().replace(',', '.');
    if (!normalized) {
        return null;
    }

    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) && parsed >= 0 ? Number(parsed.toFixed(2)) : null;
}

function defaultGoals() {
    return {
        calories: null,
        protein: null,
        carbs: null,
        fat: null
    };
}

function mealSortValue(meal) {
    const order = ['Desayuno', 'Comida', 'Cena', 'Snack', 'Pre entreno', 'Post entreno'];
    const index = order.indexOf(meal);
    return index === -1 ? order.length : index;
}

function sortEntries(entries) {
    return [...entries].sort((left, right) => {
        if (left.date !== right.date) {
            return right.date.localeCompare(left.date);
        }

        const mealDifference = mealSortValue(left.meal) - mealSortValue(right.meal);
        if (mealDifference !== 0) {
            return mealDifference;
        }

        return left.name.localeCompare(right.name, 'es', { sensitivity: 'base' });
    });
}

function getEntryTotals(entries) {
    return entries.reduce((totals, entry) => {
        totals.calories += Number(entry.calories || 0);
        totals.protein += Number(entry.protein || 0);
        totals.carbs += Number(entry.carbs || 0);
        totals.fat += Number(entry.fat || 0);
        totals.grams += Number(entry.grams || 0);
        totals.items += 1;
        return totals;
    }, {
        calories: 0,
        protein: 0,
        carbs: 0,
        fat: 0,
        grams: 0,
        items: 0
    });
}

function formatMetric(value, suffix = '') {
    const numeric = Number(value || 0);
    return `${numeric % 1 === 0 ? numeric.toFixed(0) : numeric.toFixed(1)}${suffix}`;
}

export function createNutritionController({ elements, api, dialogs }) {
    let nutritionData = {
        goals: defaultGoals(),
        entries: []
    };

    function getSelectedDate() {
        return elements.nutritionDateInput.value || toIsoDate(new Date());
    }

    function getEntriesForDate(date) {
        return nutritionData.entries.filter((entry) => entry.date === date);
    }

    function renderGoals() {
        const goals = nutritionData.goals || defaultGoals();
        elements.nutritionGoalCaloriesInput.value = goals.calories ?? '';
        elements.nutritionGoalProteinInput.value = goals.protein ?? '';
        elements.nutritionGoalCarbsInput.value = goals.carbs ?? '';
        elements.nutritionGoalFatInput.value = goals.fat ?? '';
    }

    function renderSummary() {
        const goals = nutritionData.goals || defaultGoals();
        const dayEntries = getEntriesForDate(getSelectedDate());
        const totals = getEntryTotals(dayEntries);
        const metrics = [
            { key: 'calories', label: 'Kcal', suffix: ' kcal' },
            { key: 'protein', label: 'Proteina', suffix: ' g' },
            { key: 'carbs', label: 'Carbs', suffix: ' g' },
            { key: 'fat', label: 'Grasas', suffix: ' g' }
        ];

        const cards = metrics.map(({ key, label, suffix }) => {
            const totalValue = totals[key];
            const goalValue = goals[key];
            const delta = goalValue === null ? null : Number((goalValue - totalValue).toFixed(1));
            return `
                <article class="nutrition-summary-card">
                    <span class="progress-summary-kicker">${label}</span>
                    <strong>${formatMetric(totalValue, suffix)}</strong>
                    <p>${goalValue === null ? 'Sin objetivo definido' : `Objetivo ${formatMetric(goalValue, suffix)} · ${delta >= 0 ? 'Restan' : 'Exceso'} ${formatMetric(Math.abs(delta), suffix)}`}</p>
                </article>
            `;
        });

        cards.push(`
            <article class="nutrition-summary-card nutrition-summary-card-wide">
                <span class="progress-summary-kicker">Registro del dia</span>
                <strong>${totals.items} alimentos</strong>
                <p>${totals.grams ? `${formatMetric(totals.grams, ' g')} registrados` : 'Empieza anadiendo alimentos'}.</p>
            </article>
        `);

        elements.nutritionSummaryGrid.innerHTML = cards.join('');
    }

    function bindDayActions() {
        elements.nutritionEntriesContainer.querySelectorAll('[data-delete-entry]').forEach((button) => {
            if (button.dataset.bound === 'true') {
                return;
            }

            button.dataset.bound = 'true';
            button.addEventListener('click', async () => {
                const entryId = button.dataset.deleteEntry;
                if (!entryId) {
                    return;
                }
                const confirmed = await dialogs.confirm('Eliminar alimento', '¿Quieres eliminar este alimento del registro?');
                if (!confirmed) {
                    return;
                }

                try {
                    await dialogs.withLoading('Eliminando alimento...', async () => {
                        await api.deleteNutritionEntry(entryId);
                    });
                    await loadNutrition();
                } catch (error) {
                    console.error('Error eliminando alimento:', error);
                    await dialogs.alert('Nutricion', error.message || 'No se pudo eliminar el alimento.');
                }
            });
        });

        elements.nutritionRecentDays.querySelectorAll('[data-nutrition-date]').forEach((button) => {
            if (button.dataset.bound === 'true') {
                return;
            }

            button.dataset.bound = 'true';
            button.addEventListener('click', () => {
                const nextDate = button.dataset.nutritionDate;
                if (!nextDate) {
                    return;
                }
                elements.nutritionDateInput.value = nextDate;
                renderNutrition();
            });
        });
    }

    function renderEntries() {
        const selectedDate = getSelectedDate();
        const dayEntries = getEntriesForDate(selectedDate);
        const totals = getEntryTotals(dayEntries);

        elements.nutritionDayStatus.textContent = dayEntries.length
            ? `${dayEntries.length} alimentos · ${formatMetric(totals.calories, ' kcal')} · ${formatMetric(totals.protein, ' g')} prot.`
            : 'Sin alimentos registrados para esta fecha.';

        if (!dayEntries.length) {
            elements.nutritionEntriesContainer.innerHTML = '<div class="empty-state"><p>No hay alimentos registrados para este dia.</p></div>';
            return;
        }

        const grouped = dayEntries.reduce((accumulator, entry) => {
            if (!accumulator[entry.meal]) {
                accumulator[entry.meal] = [];
            }
            accumulator[entry.meal].push(entry);
            return accumulator;
        }, {});

        const meals = Object.keys(grouped).sort((left, right) => mealSortValue(left) - mealSortValue(right));
        elements.nutritionEntriesContainer.innerHTML = meals.map((meal) => {
            const entries = grouped[meal];
            const mealTotals = getEntryTotals(entries);
            return `
                <article class="nutrition-meal-card">
                    <div class="nutrition-meal-header">
                        <div>
                            <h4>${escapeHtml(meal)}</h4>
                            <p>${entries.length} alimentos · ${formatMetric(mealTotals.calories, ' kcal')}</p>
                        </div>
                        <div class="nutrition-meal-macros">
                            <span>P ${formatMetric(mealTotals.protein, 'g')}</span>
                            <span>C ${formatMetric(mealTotals.carbs, 'g')}</span>
                            <span>G ${formatMetric(mealTotals.fat, 'g')}</span>
                        </div>
                    </div>
                    <div class="nutrition-meal-items">
                        ${entries.map((entry) => `
                            <div class="nutrition-entry-item">
                                <div class="nutrition-entry-copy">
                                    <div class="nutrition-entry-headline">
                                        <strong>${escapeHtml(entry.name)}</strong>
                                        <span>${entry.grams ? `${formatMetric(entry.grams, ' g')} · ` : ''}${formatMetric(entry.calories, ' kcal')}</span>
                                    </div>
                                    <p>P ${formatMetric(entry.protein, 'g')} · C ${formatMetric(entry.carbs, 'g')} · G ${formatMetric(entry.fat, 'g')}${entry.notes ? ` · ${escapeHtml(entry.notes)}` : ''}</p>
                                </div>
                                <button type="button" class="nutrition-delete-btn" data-delete-entry="${escapeHtml(entry.id)}" aria-label="Eliminar alimento">✕</button>
                            </div>
                        `).join('')}
                    </div>
                </article>
            `;
        }).join('');
    }

    function renderRecentDays() {
        if (!nutritionData.entries.length) {
            elements.nutritionRecentDays.innerHTML = '<div class="empty-state"><p>Todavia no hay dias con ingesta registrada.</p></div>';
            return;
        }

        const grouped = nutritionData.entries.reduce((accumulator, entry) => {
            if (!accumulator[entry.date]) {
                accumulator[entry.date] = [];
            }
            accumulator[entry.date].push(entry);
            return accumulator;
        }, {});

        const goals = nutritionData.goals || defaultGoals();
        const recentDates = Object.keys(grouped).sort((left, right) => right.localeCompare(left)).slice(0, 7);
        elements.nutritionRecentDays.innerHTML = recentDates.map((date) => {
            const totals = getEntryTotals(grouped[date]);
            const caloriesDelta = goals.calories === null ? null : Number((totals.calories - goals.calories).toFixed(1));
            return `
                <button type="button" class="nutrition-recent-day" data-nutrition-date="${escapeHtml(date)}">
                    <span class="nutrition-recent-date">${escapeHtml(date)}</span>
                    <strong>${formatMetric(totals.calories, ' kcal')}</strong>
                    <p>${totals.items} alimentos · P ${formatMetric(totals.protein, 'g')} · C ${formatMetric(totals.carbs, 'g')} · G ${formatMetric(totals.fat, 'g')}</p>
                    <span class="nutrition-recent-delta ${caloriesDelta === null ? '' : caloriesDelta > 0 ? 'is-over' : 'is-under'}">${caloriesDelta === null ? 'Sin objetivo' : caloriesDelta === 0 ? 'Objetivo clavado' : caloriesDelta > 0 ? `+${formatMetric(caloriesDelta, ' kcal')}` : `-${formatMetric(Math.abs(caloriesDelta), ' kcal')}`}</span>
                </button>
            `;
        }).join('');
    }

    function renderNutrition() {
        renderGoals();
        renderSummary();
        renderEntries();
        renderRecentDays();
        bindDayActions();
    }

    async function loadNutrition() {
        try {
            const payload = await api.getNutrition();
            nutritionData = {
                goals: {
                    ...defaultGoals(),
                    ...(payload?.goals || {})
                },
                entries: sortEntries(Array.isArray(payload?.entries) ? payload.entries.map((entry) => ({
                    id: String(entry.id || ''),
                    date: String(entry.date || ''),
                    meal: String(entry.meal || 'Comida'),
                    name: String(entry.name || ''),
                    grams: Number(entry.grams || 0) || 0,
                    calories: Number(entry.calories || 0) || 0,
                    protein: Number(entry.protein || 0) || 0,
                    carbs: Number(entry.carbs || 0) || 0,
                    fat: Number(entry.fat || 0) || 0,
                    notes: String(entry.notes || '')
                })).filter((entry) => entry.id && entry.date && entry.name) : [])
            };
            renderNutrition();
        } catch (error) {
            console.error('Error cargando nutricion:', error);
            elements.nutritionSummaryGrid.innerHTML = '<div class="empty-state"><p>No se pudo cargar nutricion.</p></div>';
            elements.nutritionEntriesContainer.innerHTML = '';
            elements.nutritionRecentDays.innerHTML = '';
        }
    }

    async function saveGoals() {
        const payload = {
            calories: parseNumericInput(elements.nutritionGoalCaloriesInput.value),
            protein: parseNumericInput(elements.nutritionGoalProteinInput.value),
            carbs: parseNumericInput(elements.nutritionGoalCarbsInput.value),
            fat: parseNumericInput(elements.nutritionGoalFatInput.value)
        };

        try {
            elements.saveNutritionGoalsBtn.disabled = true;
            elements.saveNutritionGoalsBtn.textContent = 'Guardando...';
            await api.saveNutritionGoals(payload);
            await loadNutrition();
        } catch (error) {
            console.error('Error guardando objetivos:', error);
            await dialogs.alert('Nutricion', error.message || 'No se pudieron guardar los objetivos.');
        } finally {
            elements.saveNutritionGoalsBtn.disabled = false;
            elements.saveNutritionGoalsBtn.textContent = 'Guardar objetivos';
        }
    }

    async function saveEntry() {
        const payload = {
            date: elements.nutritionDateInput.value,
            meal: elements.nutritionMealSelect.value,
            name: elements.nutritionFoodNameInput.value.trim(),
            grams: parseNumericInput(elements.nutritionFoodGramsInput.value),
            calories: parseNumericInput(elements.nutritionFoodCaloriesInput.value),
            protein: parseNumericInput(elements.nutritionFoodProteinInput.value),
            carbs: parseNumericInput(elements.nutritionFoodCarbsInput.value),
            fat: parseNumericInput(elements.nutritionFoodFatInput.value),
            notes: elements.nutritionFoodNotesInput.value.trim()
        };

        if (!payload.date || !payload.name) {
            await dialogs.alert('Nutricion', 'Introduce una fecha y el nombre del alimento.');
            return;
        }

        if ([payload.grams, payload.calories, payload.protein, payload.carbs, payload.fat].every((value) => value === null)) {
            await dialogs.alert('Nutricion', 'Añade gramos, kcal o algun macro para guardar el alimento.');
            return;
        }

        try {
            elements.saveNutritionEntryBtn.disabled = true;
            elements.saveNutritionEntryBtn.textContent = 'Guardando...';
            await api.saveNutritionEntry(payload);
            elements.nutritionFoodNameInput.value = '';
            elements.nutritionFoodGramsInput.value = '';
            elements.nutritionFoodCaloriesInput.value = '';
            elements.nutritionFoodProteinInput.value = '';
            elements.nutritionFoodCarbsInput.value = '';
            elements.nutritionFoodFatInput.value = '';
            elements.nutritionFoodNotesInput.value = '';
            await loadNutrition();
            elements.nutritionFoodNameInput.focus();
        } catch (error) {
            console.error('Error guardando alimento:', error);
            await dialogs.alert('Nutricion', error.message || 'No se pudo guardar el alimento.');
        } finally {
            elements.saveNutritionEntryBtn.disabled = false;
            elements.saveNutritionEntryBtn.textContent = 'Guardar alimento';
        }
    }

    function init() {
        const today = toIsoDate(new Date());
        elements.nutritionDateInput.value = today;
        elements.saveNutritionGoalsBtn?.addEventListener('click', saveGoals);
        elements.saveNutritionEntryBtn?.addEventListener('click', saveEntry);
        elements.nutritionDateInput?.addEventListener('change', renderNutrition);
        elements.nutritionFoodNotesInput?.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                saveEntry();
            }
        });
    }

    return {
        init,
        loadNutrition
    };
}