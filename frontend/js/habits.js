// Daily habits and streaks — Tauri version

import { getState, save, todayKey, shiftKey, keyToDate, lastNDays, uid } from './storage.js';

const { invoke } = window.__TAURI__.core;

let editingId = null;
let confirmDeleteId = null;

// ----- completion data -----

export async function isHabitDone(id, key) {
    const state = await getState();
    return Boolean(state.habit_days[id]?.[key]);
}

export async function toggleHabit(id) {
    await invoke('toggle_habit', { habitId: id });
    save();
    render();
}

export async function addHabit(name) {
    await invoke('add_habit', { name });
    save();
    render();
}

export async function renameHabit(id, name) {
    await invoke('rename_habit', { habitId: id, name });
    save();
    render();
}

export async function deleteHabit(id) {
    await invoke('delete_habit', { habitId: id });
    save();
    render();
}

function habitsOn(state, key) {
    return state.habits.filter((h) => h.created_at == null || h.created_at <= key);
}

function allDoneOn(state, key) {
    const applicable = habitsOn(state, key);
    return applicable.length > 0 && applicable.every((h) => state.habit_days[h.id]?.[key]);
}

export async function doneTodayCount() {
    const state = await getState();
    const today = todayKey();
    return habitsOn(state, today).filter((h) => state.habit_days[h.id]?.[today]).length;
}

// ----- streak math -----

export async function habitStreak(id) {
    const state = await getState();
    const days = state.habit_days[id] ?? {};
    let key = todayKey();
    if (!days[key]) key = shiftKey(key, -1);
    let streak = 0;
    while (days[key]) {
        streak += 1;
        key = shiftKey(key, -1);
    }
    return streak;
}

export async function overallStreak() {
    const state = await getState();
    let key = todayKey();
    if (!allDoneOn(state, key)) key = shiftKey(key, -1);
    let streak = 0;
    while (allDoneOn(state, key)) {
        streak += 1;
        key = shiftKey(key, -1);
    }
    return streak;
}

export async function bestStreak() {
    const state = await getState();
    const doneDays = new Set();
    for (const h of state.habits) {
        for (const key of Object.keys(state.habit_days[h.id] ?? {})) {
            if (allDoneOn(state, key)) doneDays.add(key);
        }
    }
    let best = 0;
    let run = 0;
    let prev = null;
    for (const key of [...doneDays].sort()) {
        run = prev !== null && shiftKey(prev, 1) === key ? run + 1 : 1;
        if (run > best) best = run;
        prev = key;
    }
    return best;
}

// ----- rendering -----

const weekdayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'narrow' });
const shortDateFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });

const streakText = (n) => (n === 1 ? '1 day' : `${n} days`);

function habitRow(habit, state) {
    if (habit.id === editingId) return habitEditRow(habit);
    if (habit.id === confirmDeleteId) return habitConfirmRow(habit);

    const li = document.createElement('li');
    li.className = 'habit-row';

    const label = document.createElement('label');
    label.className = 'habit-label';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = state.habit_days[habit.id]?.[todayKey()] ?? false;
    checkbox.setAttribute('aria-label', `Mark "${habit.name}" as done for today`);
    checkbox.addEventListener('change', () => toggleHabit(habit.id));
    const name = document.createElement('span');
    name.className = 'habit-name';
    name.textContent = habit.name;
    label.append(checkbox, name);

    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'todo-edit';
    edit.textContent = '✎';
    edit.title = 'Rename habit';
    edit.setAttribute('aria-label', `Rename habit: ${habit.name}`);
    edit.addEventListener('click', () => {
        confirmDeleteId = null;
        editingId = habit.id;
        render();
    });

    li.append(label, edit);

    // Every habit is removable — the list is allowed to go down to zero.
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'habit-delete';
    remove.textContent = '×';
    remove.title = 'Remove habit';
    remove.setAttribute('aria-label', `Remove habit: ${habit.name}`);
    remove.addEventListener('click', () => {
        editingId = null;
        confirmDeleteId = habit.id;
        render();
    });
    li.append(remove);

    return li;
}

function habitEditRow(habit) {
    const li = document.createElement('li');
    li.className = 'habit-row editing';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'input habit-edit-input';
    input.value = habit.name;
    input.maxLength = 80;
    input.setAttribute('aria-label', 'Habit name');

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'btn btn-primary btn-small';
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', () => {
        editingId = null;
        renameHabit(habit.id, input.value);
    });

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn btn-secondary btn-small';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => {
        editingId = null;
        render();
    });

    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') saveBtn.click();
        if (event.key === 'Escape') cancel.click();
    });

    li.append(input, saveBtn, cancel);
    return li;
}

function habitConfirmRow(habit) {
    const li = document.createElement('li');
    li.className = 'habit-row editing confirming';

    const text = document.createElement('span');
    text.className = 'habit-confirm-text';
    text.textContent = `Remove "${habit.name}"? Its history goes too.`;

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn btn-danger btn-small';
    del.textContent = 'Delete';
    del.addEventListener('click', () => {
        confirmDeleteId = null;
        deleteHabit(habit.id);
    });

    const keep = document.createElement('button');
    keep.type = 'button';
    keep.className = 'btn btn-secondary btn-small';
    keep.textContent = 'Keep';
    keep.addEventListener('click', () => {
        confirmDeleteId = null;
        render();
    });

    li.append(text, del, keep);
    return li;
}

function headCell(key, isToday) {
    const el = document.createElement('span');
    el.className = `head${isToday ? ' today' : ''}`;
    el.textContent = weekdayFmt.format(keyToDate(key));
    el.title = `${shortDateFmt.format(keyToDate(key))}${isToday ? ' · today' : ''}`;
    return el;
}

function bodyCell(name, key, done, isToday, extraClass = '') {
    const el = document.createElement('span');
    el.className = `cell${done ? ' done' : ''}${isToday ? ' today' : ''}${extraClass ? ` ${extraClass}` : ''}`;
    el.title = `${name} · ${shortDateFmt.format(keyToDate(key))}: ${done ? 'done' : 'not done'}${isToday ? ' (today)' : ''}`;
    return el;
}

function rowLabel(name, streak, extraClass = '') {
    const wrap = document.createElement('div');
    wrap.className = `row-label${extraClass ? ` ${extraClass}` : ''}`;
    wrap.title = `${name}: current streak ${streakText(streak)}`;
    const nameEl = document.createElement('span');
    nameEl.className = 'row-name';
    nameEl.textContent = name;
    const streakEl = document.createElement('span');
    streakEl.className = 'row-streak';
    streakEl.textContent = streakText(streak);
    wrap.append(nameEl, streakEl);
    return wrap;
}

async function renderGrid(state) {
    const grid = document.getElementById('streakGrid');
    const days = lastNDays(14);
    const today = todayKey();

    const frag = document.createDocumentFragment();
    const corner = document.createElement('span');
    corner.className = 'head';
    frag.append(corner);
    for (const key of days) frag.append(headCell(key, key === today));

    for (const habit of state.habits) {
        frag.append(rowLabel(habit.name, await habitStreak(habit.id)));
        for (const key of days) {
            frag.append(bodyCell(habit.name, key, state.habit_days[habit.id]?.[key], key === today));
        }
    }

    const divider = document.createElement('div');
    divider.className = 'grid-divider';
    frag.append(divider);

    frag.append(rowLabel('All habits', await overallStreak(), 'row-all'));
    for (const key of days) {
        frag.append(bodyCell('All habits', key, allDoneOn(state, key), key === today, 'row-all'));
    }

    grid.replaceChildren(frag);
}

export async function render() {
    const state = await getState();
    const list = document.getElementById('habitList');
    const rows = [];
    for (const habit of state.habits) {
        const row = habitRow(habit, state);
        const checkbox = row.querySelector('input[type="checkbox"]');
        if (checkbox) checkbox.checked = state.habit_days[habit.id]?.[todayKey()] ?? false;
        rows.push(row);
    }

    // Empty state — a fresh install has no habits until the user adds some.
    if (rows.length === 0) {
        const empty = document.createElement('li');
        empty.className = 'habit-empty';
        const emptyTitle = document.createElement('p');
        emptyTitle.className = 'habit-empty-title';
        emptyTitle.textContent = 'No habits yet';
        const emptyHint = document.createElement('p');
        emptyHint.className = 'habit-empty-hint';
        emptyHint.textContent = 'Add your first habit below to start tracking streaks.';
        empty.append(emptyTitle, emptyHint);
        rows.push(empty);
    }
    list.replaceChildren(...rows);

    if (editingId) {
        const input = list.querySelector('.habit-edit-input');
        if (input) input.focus();
    }

    const done = await doneTodayCount();
    const total = state.habits.length;
    const pct = total > 0 ? (done / total) * 100 : 0;
    document.getElementById('habitProgressBar').style.width = `${pct}%`;
    document.getElementById('habitProgressText').textContent =
        total > 0 ? `${done} of ${total} done today` : 'No habits yet — add your first one';

    document.getElementById('overallStreak').textContent = String(await overallStreak());
    document.getElementById('bestStreak').textContent = String(await bestStreak());
    document.getElementById('todayDone').textContent = `${done}/${total}`;

    await renderGrid(state);
}

export async function init() {
    const form = document.getElementById('habitForm');
    const input = document.getElementById('habitName');
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        await addHabit(input.value);
        input.value = '';
        input.focus();
    });
    await render();
}