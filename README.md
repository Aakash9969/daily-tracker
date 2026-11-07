# Daily Tracker

A native desktop app for daily habits, water tracking, focus sessions, and tasks. Built with **Tauri v2** (Rust + WebView2) — small, fast, and truly native.

**Download:** grab the latest installer from [Releases](https://github.com/Aakash9969/daily-tracker/releases/latest) — no Python, no Node, no browser needed.

## Features

- **Daily habits** — checkboxes that reset each day. The list starts **empty**, so every install is yours to build. Edit it in the app: **Add habit** box, **✎** renames (keeps streak), **×** removes after confirmation (including the last one). Streaks and the 14-day grid update automatically. A habit starts counting toward the overall streak from the day *after* you add it, so adding one never lowers your current streak.
- **Streaks** — per-habit current streaks, overall streak (days when every habit that existed was done), best streak ever, and a 14-day grid with today outlined.
- **Colour themes** — pick an accent colour (teal, violet, rose, amber, green, slate) from the dots in the header. Saved with your data and applied in both light and dark mode.
- **Water tracker** — glass counter with undo, editable daily goal (default 8), droplet icons that fill up, reminders at 1/20/30/45/60-minute intervals. When a reminder fires you get a loud alarm buzzer, a native OS notification that stays on screen, a flashing taskbar title, and an in-page banner. **Test reminder** button checks the whole chain instantly.
- **Focus session** — 1/25/50/90-minute timer with start, pause, resume, reset. Remaining time shows in the window title while minimized. Completion adds minutes to "Focus time today" with a buzzer + notification.
- **Must-do list** — one-time tasks with optional due dates, editable inline (✎), removable. Sorted: overdue → by due date → undated. Tick **Daily** while adding and it goes to the Habits card instead.
- **System tray** — minimize to tray, double-click to restore, right-click → Quit.
- **Single instance** — launching again just focuses the existing window.
- **Data stored locally** in your OS app data folder (`%LOCALAPPDATA%\com.dailytracker.desktop\state.json`) — no browser, no cloud. Nothing is baked into the app binary; every install starts with an empty habit list.

## Run it

**Double-click `Daily tracker.exe`** — that's it. No terminal, no server, no browser.

### Start with Windows (optional)
1. Win+R → `shell:startup`
2. Create a shortcut to `Daily tracker.exe` in that folder.

### Desktop shortcut
Right-click the exe → *Send to → Desktop (create shortcut)*.

---

## Build from source

### Prerequisites
- **Rust** (stable): `https://rustup.rs/`
- **Node.js** (for Tauri CLI): `https://nodejs.org/`
- **WebView2** runtime (Windows 10/11 has it built-in; if missing, Tauri will prompt)

### One-time setup
```powershell
# Install Tauri CLI
cargo install tauri-cli --locked
```

### Build
```powershell
cd C:\Personal\Projects\tracker
cargo tauri build
```

The release binary appears at `src-tauri/target/release/daily-tracker.exe` (and gets copied to the project root by the build script).

### Output
- **Windows**: `Daily tracker.exe` (~16 MB) + optional `.msi` installer in `src-tauri/target/release/bundle/`
- **macOS**: `.app` bundle + `.dmg` in `src-tauri/target/release/bundle/`
- **Linux**: `.AppImage` + `.deb`/`.rpm` in `src-tauri/target/release/bundle/`

Cross-compilation isn't supported — build on each target OS (or use GitHub Actions, below).

---

## Share on GitHub

### 1. Push the repo
```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/daily-tracker.git
git push -u origin main
```

### 2. Enable GitHub Actions for cross-platform releases
Create `.github/workflows/release.yml`:

```yaml
name: Release

on:
  push:
    tags:
      - 'v*'

permissions:
  contents: write

jobs:
  build:
    strategy:
      matrix:
        include:
          - os: windows-latest
            artifact: Daily tracker.exe
          - os: macos-latest
            artifact: Daily Tracker.app
          - os: ubuntu-latest
            artifact: daily-tracker.AppImage
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - name: Install Rust
        uses: dtolnay/rust-toolchain@stable
      - name: Install Node
        uses: actions/setup-node@v4
        with:
          node-version: '20'
      - name: Install Tauri CLI
        run: cargo install tauri-cli --locked
      - name: Build
        run: cargo tauri build
      - name: Upload artifact
        uses: actions/upload-artifact@v4
        with:
          name: ${{ matrix.artifact }}
          path: |
            src-tauri/target/release/bundle/**/*
            src-tauri/target/release/daily-tracker.exe
  release:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - name: Download all artifacts
        uses: actions/download-artifact@v4
        with:
          path: artifacts
      - name: Create Release
        uses: softprops/action-gh-release@v1
        with:
          files: artifacts/**/*
          generate_release_notes: true
```

### 3. Tag a release
```bash
git tag v1.0.0
git push origin v1.0.0
```

GitHub Actions will build for Windows, macOS, and Linux, then create a Release with all three installers attached.

---

## Project structure

```
Daily tracker.exe          ← Native app (double-click to run)
src-tauri/                 ← Rust backend
  Cargo.toml               ← Dependencies
  tauri.conf.json          ← Tauri config (window, bundle, icons)
  capabilities/default.json← Permissions (notifications, tray, fs, etc.)
  src/lib.rs               ← Commands: habits, water, focus, todos, tray, reminders
  icons/                   ← App icons (PNG, ICO, ICNS)
frontend/                  ← Web frontend (runs in WebView2)
  index.html               ← Page structure
  styles.css               ← Light/dark theme, layout, components
  js/
    app.js                 ← Wiring + 1-second clock
    storage.js             ← Tauri invoke bridge (replaces localStorage)
    habits.js              ← Habits + streaks + 14-day grid
    water.js               ← Water counter + reminders
    focus.js               ← Focus timer
    todos.js               ← Must-do list
    alerts.js              ← Buzzer + native notifications + banner
    theme.js               ← Accent colour picker
```

---

## Data location

- **Windows**: `%LOCALAPPDATA%\com.dailytracker.desktop\state.json`
- **macOS**: `~/Library/Application Support/com.dailytracker.desktop/state.json`
- **Linux**: `~/.local/share/com.dailytracker.desktop/state.json`

To back up: copy `state.json`. To reset: delete it.

---

## Development

```bash
# Run in dev mode (hot reload)
cargo tauri dev
```

---

## License

MIT