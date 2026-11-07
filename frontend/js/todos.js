// Must-do list — Tauri version

import { getState, save, todayKey, shiftKey, formatShortDate, uid } from './storage.js';
import { showBanner } from './alerts.js';
import { addHabit } from './habits.js';

const { invoke } = window.__TAURI__.core;

let form, textInput, dateInput, dailyToggle, addButton, listEl, emptyEl, countEl;
let editingId = null;

function isOverdue(todo) {
    return !todo.done && Boolean(todo.due) && todo.due < todayKey();
}

export function sortedTodos(todos) {
    const today = todayKey();
    const rank = (t) => {
        if (t.done) return 9;
        if (t.due && t.due < today) return 0;
        if (t.due) return 2;
        return 3;
    };
    return [...todos].sort((a, b) => {
        const ra = rank(a);
        const rb = rank(b);
        if (ra !== rb) return ra - rb;
        const da = a.due ?? '9999-99-99';
        const db = b.due ?? '9999-99-99';
        if (da !== db) return da < db ? -1 : 1;
        return a.created_at - b.created_at;
    });
}

function chipInfo(todo) {
    const today = todayKey();
    if (!todo.due) return null;
    if (todo.due === today) return { label: 'Today', cls: 'today' };
    if (todo.due === shiftKey(today, 1)) return { label: 'Tomorrow', cls: '' };
    if (isOverdue(todo)) return { label: `Overdue · ${formatShortDate(todo.due)}`, cls: 'overdue' };
    if (todo.done) return { label: formatShortDate(todo.due), cls: '' };
    return { label: `Due ${formatShortDate(todo.due)}`, cls: '' };
}

export async function addTodo(text, due) {
    await invoke('add_todo', { text, due });
    save();
    render();
}

export async function toggleTodo(id) {
    await invoke('toggle_todo', { id });
    save();
    render();
}

export async function removeTodo(id) {
    await invoke('remove_todo', { id });
    save();
    render();
}

export function beginEdit(id) {
    editingId = id;
    render();
}

export function cancelEdit() {
    editingId = null;
    render();
}

export async function saveEdit(id, text, due) {
    await invoke('save_todo_edit', { id, text, due });
    editingId = null;
    save();
    render();
}

function todoRow(todo) {
    if (todo.id === editingId) return editRow(todo);

    const li = document.createElement('li');
    li.className = `todo-item${todo.done ? ' done' : ''}${isOverdue(todo) ? ' overdue' : ''}`;

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = todo.done;
    checkbox.setAttribute('aria-label', `Mark "${todo.text}" as ${todo.done ? 'not done' : 'done'}`);
    checkbox.addEventListener('change', () => toggleTodo(todo.id));

    const body = document.createElement('div');
    body.className = 'todo-body';
    const text = document.createElement('span');
    text.className = 'todo-text-span';
    text.textContent = todo.text;
    body.append(text);

    const info = chipInfo(todo);
    if (info) {
        const chip = document.createElement('span');
        chip.className = `chip ${info.cls}`.trim();
        chip.textContent = info.label;
        body.append(chip);
    }

    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'todo-edit';
    edit.textContent = '✎';
    edit.title = 'Edit task';
    edit.setAttribute('aria-label', `Edit task: ${todo.text}`);
    edit.addEventListener('click', () => beginEdit(todo.id));

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'todo-remove';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `Remove task: ${todo.text}`);
    remove.addEventListener('click', () => removeTodo(todo.id));

    li.append(checkbox, body, edit, remove);
    return li;
}

function editRow(todo) {
    const li = document.createElement('li');
    li.className = 'todo-item editing';

    const text = document.createElement('input');
    text.type = 'text';
    text.className = 'input todo-edit-text';
    text.value = todo.text;
    text.maxLength = 200;
    text.setAttribute('aria-label', 'Task text');

    const date = document.createElement('input');
    date.type = 'date';
    date.className = 'input todo-edit-date';
    date.value = todo.due ?? '';
    date.setAttribute('aria-label', 'Due date (optional)');

    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'btn btn-primary btn-small';
    save.textContent = 'Save';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn btn-secondary btn-small';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', cancelEdit);
    save.addEventListener('click', () => saveEdit(todo.id, text.value, date.value));

    text.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') save.click();
        if (event.key === 'Escape') cancelEdit();
    });

    li.append(text, date, save, cancel);
    return li;
}

export async function render() {
    const state = await getState();
    const frag = document.createDocumentFragment();
    for (const todo of sortedTodos(state.todos)) frag.append(todoRow(todo));
    listEl.replaceChildren(frag);
    emptyEl.hidden = state.todos.length > 0;

    if (editingId) {
        const input = listEl.querySelector('.todo-edit-text');
        if (input) input.focus();
    }

    const open = state.todos.filter((t) => !t.done).length;
    const overdue = state.todos.filter(isOverdue).length;
    countEl.textContent = state.todos.length === 0
        ? ''
        : overdue > 0 ? `${open} open · ${overdue} overdue` : `${open} open`;
}

export async function init() {
    form = document.getElementById('todoForm');
    textInput = document.getElementById('todoText');
    dateInput = document.getElementById('todoDate');
    dailyToggle = document.getElementById('todoDailyToggle');
    addButton = document.getElementById('todoAddButton');
    listEl = document.getElementById('todoList');
    emptyEl = document.getElementById('todoEmpty');
    countEl = document.getElementById('todoCount');

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const text = textInput.value.trim();
        if (!text) {
            textInput.focus();
            return;
        }
        if (dailyToggle.checked) {
            await addHabit(text);
            showBanner({
                title: 'Added to Daily habits',
                message: `"${text}" now lives in the Daily habits card — it resets every morning.`,
                accent: 'teal',
            });
        } else {
            await addTodo(text, dateInput.value || null);
        }
        textInput.value = '';
        dateInput.value = '';
        dailyToggle.checked = false;
        dateInput.disabled = false;
        updateAddButton();
        textInput.focus();
    });

    dailyToggle.addEventListener('change', () => {
        dateInput.disabled = dailyToggle.checked;
        if (dailyToggle.checked) dateInput.value = '';
        updateAddButton();
    });

    await render();
}

function updateAddButton() {
    addButton.textContent = dailyToggle.checked ? 'Add daily habit' : 'Add task';
}