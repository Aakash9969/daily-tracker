// Sounds, browser notifications and in-page banner — Tauri version

let audioCtx = null;

export function unlockAudio() {
    try {
        if (!audioCtx) {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (AC) audioCtx = new AC();
        }
        if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    } catch (err) {
        audioCtx = null;
    }
}
window.addEventListener('pointerdown', unlockAudio, { once: true, capture: true });
window.addEventListener('keydown', unlockAudio, { once: true, capture: true });

// A loud alarm-clock buzzer
export function playAlarm() {
    unlockAudio();
    if (!audioCtx || audioCtx.state !== 'running') return false;
    const ctx = audioCtx;
    const t0 = ctx.currentTime + 0.03;

    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.12;
    limiter.connect(ctx.destination);

    for (let round = 0; round < 3; round++) {
        for (let pulse = 0; pulse < 4; pulse++) {
            const t = t0 + round * 0.62 + pulse * 0.14;
            const freq = pulse % 2 === 0 ? 1046.5 : 830.61;
            schedulePulse(ctx, limiter, t, 0.1, freq);
        }
    }
    return true;
}

function schedulePulse(ctx, out, t, dur, freq) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(0.55, t + 0.006);
    gain.gain.setValueAtTime(0.55, t + dur - 0.02);
    gain.gain.linearRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.02);
}

// Tauri native notifications
const { invoke } = window.__TAURI__.core;

export function notificationsSupported() {
    return true; // Tauri handles native notifications
}

export function notificationPermission() {
    return Notification.permission;
}

export async function requestNotificationPermission() {
    return Notification.permission;
}

export async function showNotification(title, body, tag) {
    try {
        await invoke('show_notification', { title, body });
        return true;
    } catch (e) {
        return false;
    }
}

// In-page banner (same as before)
const banner = document.getElementById('banner');
const bannerTitle = document.getElementById('bannerTitle');
const bannerMessage = document.getElementById('bannerMessage');
const bannerAction = document.getElementById('bannerAction');
const bannerClose = document.getElementById('bannerClose');

let bannerTimer = null;
let bannerActionFn = null;

export function showBanner({ title, message, accent = 'water', actionLabel, onAction }) {
    bannerTitle.textContent = title;
    bannerMessage.textContent = message;
    banner.dataset.accent = accent;
    bannerActionFn = actionLabel && onAction ? onAction : null;
    if (bannerActionFn) {
        bannerAction.textContent = actionLabel;
        bannerAction.hidden = false;
    } else {
        bannerAction.hidden = true;
    }
    banner.inert = false;
    banner.classList.add('show');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(hideBanner, 90000);
}

export function hideBanner() {
    clearTimeout(bannerTimer);
    banner.classList.remove('show');
    banner.inert = true;
    bannerActionFn = null;
    stopTitleFlash();
}

bannerClose.addEventListener('click', hideBanner);
bannerAction.addEventListener('click', () => {
    const fn = bannerActionFn;
    hideBanner();
    if (fn) fn();
});

// Tab title flashing
const DEFAULT_TITLE = document.title;
let flashTimer = null;

export function startTitleFlash(message) {
    if (!document.hidden || flashTimer) return;
    let on = true;
    document.title = `⏰ ${message}`;
    flashTimer = setInterval(() => {
        on = !on;
        document.title = on ? `⏰ ${message}` : DEFAULT_TITLE;
    }, 1000);
    setTimeout(stopTitleFlash, 90000);
}

export function stopTitleFlash() {
    if (flashTimer) {
        clearInterval(flashTimer);
        flashTimer = null;
    }
    document.title = DEFAULT_TITLE;
}

export function titleFlashActive() {
    return flashTimer !== null;
}

document.addEventListener('visibilitychange', () => {
    if (!document.hidden) stopTitleFlash();
});

// Full alert stack
export async function remind({ title, message, tag, accent, actionLabel, onAction }) {
    await invoke('play_alarm_sound');
    await showNotification(title, message, tag);
    startTitleFlash(title);
    showBanner({ title, message, accent, actionLabel, onAction });
}