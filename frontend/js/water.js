// Water tracker — Tauri version

import { getState, save, todayKey, reloadFromStorage } from './storage.js';
import { hideBanner, notificationPermission, playAlarm, showBanner, startTitleFlash } from './alerts.js';

const INTERVALS = [1, 20, 30, 45, 60];

const { invoke } = window.__TAURI__.core;

let countEl, goalTextEl, goalReachedEl, dropletsEl, drankBtn, undoBtn, goalInput,
    intervalGroup, reminderToggleBtn, testBtn, statusDotEl, statusTextEl, hintEl;

function glassesToday(state) {
    return state.water.days[todayKey()] ?? 0;
}

function intervalMs(state) {
    return state.reminders.interval_min * 60000;
}

export async function logGlass() {
    await invoke('log_glass');
    await save();
    hideBanner();
    render();
}

async function undoGlass() {
    await invoke('undo_glass');
    await save();
    render();
}

async function setGoal(raw) {
    if (raw === '' || raw === null || raw === undefined) {
        render();
        return;
    }
    let goal = Math.round(Number(raw));
    if (!Number.isFinite(goal)) goal = 8;
    goal = Math.max(1, Math.min(30, goal));
    await invoke('set_water_goal', { goal });
    await save();
    render();
}

async function setIntervalMinutes(min) {
    await invoke('set_reminder_interval', { intervalMin: min });
    await save();
    render();
}

async function toggleReminders() {
    await invoke('toggle_reminders');
    await save();
    render(true);
}

async function testReminder() {
    playAlarm(); // the loud buzzer, through the app's own audio
    await invoke('test_reminder'); // native OS notification
    await reloadFromStorage();
    await render(true);
}

// Called every second by the app clock
export async function tick() {
    // The backend handles reminder firing, we just update the status UI
    renderStatus();
}

function formatWait(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    if (s === 0) return 'now';
    if (s < 60) return `${s} s`;
    return `${Math.ceil(s / 60)} min`;
}

async function statusParts() {
    const state = await getState();
    const r = state.reminders;
    if (!r.enabled) return { text: 'Reminders are off.', dot: '' };
    const next = formatWait((r.next_due_at ?? Date.now()) - Date.now());
    const perm = notificationPermission();
    if (perm === 'denied') {
        return { text: `Notifications blocked — banner and buzzer only · next reminder in ${next}`, dot: 'blocked' };
    }
    if (perm !== 'granted') {
        return { text: `Notifications not allowed yet — banner and buzzer only · next reminder in ${next}`, dot: 'blocked' };
    }
    return { text: `Reminders on · next reminder in ${next}`, dot: 'on' };
}

let lastStatusKey = '';

async function renderStatus(force = false) {
    const state = await getState();
    const parts = await statusParts();
    const key = `${state.reminders.enabled}|${parts.text}`;
    if (!force && key === lastStatusKey) return;
    lastStatusKey = key;
    statusTextEl.textContent = parts.text;
    statusDotEl.className = `status-dot ${parts.dot}`.trim();
    reminderToggleBtn.textContent = state.reminders.enabled ? 'Turn reminders off' : 'Turn reminders on';
    reminderToggleBtn.classList.toggle('btn-water', !state.reminders.enabled);
    reminderToggleBtn.classList.toggle('btn-secondary', state.reminders.enabled);
    hintEl.hidden = !(state.reminders.enabled && notificationPermission() !== 'granted');
}

const DROPLET_PATH = 'M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z';

function dropletEl(full) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('droplet');
    if (full) svg.classList.add('full');
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', DROPLET_PATH);
    svg.append(path);
    return svg;
}

export async function render(force = false) {
    const state = await getState();
    const count = glassesToday(state);
    const goal = state.water.goal;

    countEl.textContent = String(count);
    goalTextEl.textContent = `/ ${goal}`;
    goalReachedEl.hidden = count < goal;
    undoBtn.disabled = count === 0;
    goalInput.value = String(goal);

    const frag = document.createDocumentFragment();
    const total = Math.max(goal, count);
    for (let i = 0; i < total; i++) frag.append(dropletEl(i < count));
    dropletsEl.replaceChildren(frag);
    dropletsEl.setAttribute('aria-label', `${count} of ${goal} glasses today`);

    await renderStatus(force);
}

export async function init() {
    countEl = document.getElementById('waterCount');
    goalTextEl = document.getElementById('waterGoalText');
    goalReachedEl = document.getElementById('waterGoalReached');
    dropletsEl = document.getElementById('droplets');
    drankBtn = document.getElementById('drankButton');
    undoBtn = document.getElementById('undoButton');
    goalInput = document.getElementById('goalInput');
    intervalGroup = document.getElementById('intervalGroup');
    reminderToggleBtn = document.getElementById('reminderToggle');
    testBtn = document.getElementById('testReminder');
    statusDotEl = document.getElementById('statusDot');
    statusTextEl = document.getElementById('statusText');
    hintEl = document.getElementById('reminderHint');

    drankBtn.addEventListener('click', logGlass);
    undoBtn.addEventListener('click', undoGlass);
    document.getElementById('goalMinus').addEventListener('click', async () => {
        const state = await getState();
        setGoal(state.water.goal - 1);
    });
    document.getElementById('goalPlus').addEventListener('click', async () => {
        const state = await getState();
        setGoal(state.water.goal + 1);
    });
    goalInput.addEventListener('change', () => setGoal(goalInput.value));
    reminderToggleBtn.addEventListener('click', toggleReminders);
    testBtn.addEventListener('click', testReminder);

    for (const min of INTERVALS) {
        const label = document.createElement('label');
        label.className = 'pill';
        if (min === 1) label.title = 'Short interval for testing reminders';
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = 'water-reminder-interval';
        input.value = String(min);
        input.checked = (await getState()).reminders.interval_min === min;
        input.addEventListener('change', () => setIntervalMinutes(min));
        const span = document.createElement('span');
        span.textContent = min === 1 ? '1 min (test)' : `${min} min`;
        label.append(input, span);
        intervalGroup.append(label);
    }

    // Backend fires this when a water reminder is due — play the loud buzzer
    // and show the in-page banner (the OS notification comes from the backend).
    const { listen } = window.__TAURI__.event;
    await listen('reminder-fired', async (event) => {
        const p = event.payload || {};
        playAlarm();
        startTitleFlash(p.title || 'Water reminder');
        showBanner({
            title: p.title || 'Water reminder',
            message: p.message || 'Time for a glass of water.',
            accent: 'water',
            actionLabel: p.kind === 'water' ? 'I drank a glass' : undefined,
            onAction: p.kind === 'water' ? logGlass : undefined,
        });
        await reloadFromStorage();
        await render(true);
    });

    await render();
}