// Accent colour themes — pick a dot in the header; the choice is saved in app data.

import { getState, save } from './storage.js';

const { invoke } = window.__TAURI__.core;

const THEMES = [
    { id: '', label: 'Teal', swatch: '#0f766e' },
    { id: 'violet', label: 'Violet', swatch: '#6d28d9' },
    { id: 'rose', label: 'Rose', swatch: '#be123c' },
    { id: 'amber', label: 'Amber', swatch: '#b45309' },
    { id: 'green', label: 'Green', swatch: '#15803d' },
    { id: 'slate', label: 'Slate', swatch: '#475569' },
];

function apply(theme) {
    if (theme) {
        document.documentElement.dataset.accentTheme = theme;
    } else {
        delete document.documentElement.dataset.accentTheme;
    }
}

export async function init() {
    const picker = document.getElementById('themePicker');
    if (!picker) return;
    const current = (await getState()).theme || '';
    apply(current);

    for (const t of THEMES) {
        const dot = document.createElement('button');
        dot.type = 'button';
        dot.className = 'theme-dot';
        dot.style.background = t.swatch;
        dot.title = `${t.label} theme`;
        dot.setAttribute('role', 'radio');
        dot.setAttribute('aria-checked', String(current === t.id));
        dot.setAttribute('aria-label', `${t.label} theme`);
        dot.addEventListener('click', async () => {
            await invoke('set_theme', { theme: t.id });
            await save();
            apply(t.id);
            for (const d of picker.querySelectorAll('.theme-dot')) {
                d.setAttribute('aria-checked', 'false');
            }
            dot.setAttribute('aria-checked', 'true');
        });
        picker.append(dot);
    }
}