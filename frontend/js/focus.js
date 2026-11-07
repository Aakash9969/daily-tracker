// Focus session — Tauri version

import { getState, save, todayKey, reloadFromStorage } from './storage.js';
import { playAlarm, showBanner, startTitleFlash, titleFlashActive } from './alerts.js';

const DURATIONS = [
    { min: 1, label: '1 min (test)' },
    { min: 25, label: '25 min' },
    { min: 50, label: '50 min' },
    { min: 90, label: '90 min' },
];

const RING_CIRCUMFERENCE = 2 * Math.PI * 52;
const DEFAULT_TITLE = document.title;

const { invoke } = window.__TAURI__.core;

let timeEl, ringEl, startPauseBtn, resetBtn, todayEl, durationGroup;
let lastClock = '';

async function session(state) {
    return state.focus.session;
}

async function durationMs(state) {
    return state.focus.duration_min * 60000;
}

async function remainingMs(state) {
    const s = await session(state);
    if (s.running) return Math.max(0, s.end_at - Date.now());
    if (typeof s.remaining_ms === 'number') return s.remaining_ms;
    return durationMs(state);
}

function mmss(ms) {
    const total = Math.round(ms / 1000);
    const m = Math.floor(total / 60);
    const sec = total % 60;
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function setClock(el, text) {
    const frag = document.createDocumentFragment();
    for (const ch of text) {
        const span = document.createElement('span');
        span.className = ch === ':' ? 'dig dig-colon' : 'dig';
        span.textContent = ch;
        frag.append(span);
    }
    el.replaceChildren(frag);
}

export async function startPause() {
    await invoke('start_pause_focus');
    await save();
    render();
}

export async function resetSession() {
    await invoke('reset_focus');
    await save();
    render();
}

export async function tick() {
    const state = await getState();
    const s = await session(state);
    if (s.running && s.end_at && s.end_at - Date.now() <= 0) {
        // Session completed — the backend credited the minutes; refresh fully
        // so the ring, label and "focus time today" all reflect it.
        await save();
        await render();
        return;
    }
    renderTime(state);
}

async function renderTime(state) {
    const total = await durationMs(state);
    const remaining = await remainingMs(state);
    const text = mmss(remaining);
    if (text !== lastClock) {
        lastClock = text;
        setClock(timeEl, text);
    }
    ringEl.style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - remaining / total));

    // Remaining time in tab title while hidden — unless alarm flash is active
    if (!titleFlashActive()) {
        const s = await session(state);
        document.title = s.running && document.hidden
            ? `${mmss(remaining)} · Focus — ${DEFAULT_TITLE}`
            : DEFAULT_TITLE;
    }
}

export async function render() {
    const state = await getState();
    await renderTime(state);
    const s = await session(state);
    const paused = !s.running && typeof s.remaining_ms === 'number' && s.remaining_ms > 0;
    startPauseBtn.textContent = s.running ? 'Pause' : paused ? 'Resume' : 'Start';
    resetBtn.disabled = !s.running && !paused;
    todayEl.textContent = String(state.focus.days[todayKey()] ?? 0);
    durationGroup.querySelectorAll('input').forEach((input) => {
        input.checked = Number(input.value) === state.focus.duration_min;
    });
}

export async function init() {
    timeEl = document.getElementById('focusTime');
    ringEl = document.getElementById('focusRing');
    startPauseBtn = document.getElementById('focusStartPause');
    resetBtn = document.getElementById('focusReset');
    todayEl = document.getElementById('focusToday');
    durationGroup = document.getElementById('durationGroup');

    startPauseBtn.addEventListener('click', startPause);
    resetBtn.addEventListener('click', resetSession);

    for (const { min, label } of DURATIONS) {
        const labelEl = document.createElement('label');
        labelEl.className = 'pill';
        if (min === 1) labelEl.title = 'Short session for testing';
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = 'focus-duration';
        input.value = String(min);
        input.checked = (await getState()).focus.duration_min === min;
        input.addEventListener('change', async () => {
            await invoke('set_focus_duration', { durationMin: min });
            await save();
            render();
        });
        const span = document.createElement('span');
        span.textContent = label;
        labelEl.append(input, span);
        durationGroup.append(labelEl);
    }

    // Backend fires this when a focus session completes — play the buzzer
    // and show the in-page banner (the OS notification comes from the backend).
    const { listen } = window.__TAURI__.event;
    await listen('focus-completed', async (event) => {
        const minutes = (event.payload && event.payload.minutes) || 0;
        playAlarm();
        startTitleFlash('Focus complete');
        showBanner({
            title: 'Focus session complete',
            message: `${minutes} min added to focus time today — take a short break.`,
            accent: 'teal',
        });
        await reloadFromStorage();
        await render();
    });

    await render();
}