// Tauri API bridge - replaces localStorage-based storage
// All data is stored in the app's native data directory via Rust backend

export const STORAGE_KEY = 'daily-tracker-state-v1';

if (!window.__TAURI__ || !window.__TAURI__.core || !window.__TAURI__.core.invoke) {
    // This error is caught by the boot-error handler in index.html and shown on screen
    throw new Error('Tauri API not available (window.__TAURI__ is missing). Are you running the native app, not a browser?');
}

const { invoke } = window.__TAURI__.core;

let stateCache = null;
let statePromise = null;

export async function getState() {
    if (statePromise) return statePromise;
    statePromise = invoke('get_state').then(state => {
        stateCache = state;
        return state;
    });
    return statePromise;
}

export async function save() {
    statePromise = null; // Invalidate cache
    return await invoke('save_state');
}

export async function reloadFromStorage() {
    statePromise = null;
    stateCache = null;
    return getState();
}

// Date helpers (same as before)
export function dateKey(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

export function todayKey() {
    return dateKey(new Date());
}

export function keyToDate(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
}

export function shiftKey(key, days) {
    const d = keyToDate(key);
    d.setDate(d.getDate() + days);
    return dateKey(d);
}

export function lastNDays(n) {
    const keys = [];
    const today = new Date();
    for (let i = n - 1; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        keys.push(dateKey(d));
    }
    return keys;
}

export function formatLongDate(date = new Date()) {
    return date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

export function formatShortDate(key) {
    return keyToDate(key).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export const uid = () =>
    typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;