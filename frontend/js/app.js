// Daily tracker — Tauri app entry point

import { STORAGE_KEY, todayKey, formatLongDate } from './storage.js';
import * as habits from './habits.js';
import * as water from './water.js';
import * as focus from './focus.js';
import * as todos from './todos.js';
import * as theme from './theme.js';

const todayLabel = document.getElementById('todayLabel');

function setHeaderDate() {
    todayLabel.textContent = formatLongDate();
}

async function rerenderAll() {
    await habits.render();
    await water.render();
    await focus.render();
    await todos.render();
}

let currentDay = todayKey();

async function tick() {
    const day = todayKey();
    if (day !== currentDay) {
        currentDay = day;
        setHeaderDate();
        await rerenderAll();
    }
    await water.tick();
    await focus.tick();
}

setHeaderDate();
await theme.init();
await habits.init();
await water.init();
await focus.init();
await todos.init();

setInterval(tick, 1000);
document.addEventListener('visibilitychange', tick);