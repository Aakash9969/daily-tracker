#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .setup(|app| {
            // Load persisted state into memory ONCE, synchronously, before
            // anything else can read it. The in-memory state is the single
            // source of truth from here on; the file is just its shadow.
            let wrapper = AppStateWrapper::new();
            let path = data_path(app.handle());
            if let Ok(content) = std::fs::read_to_string(&path) {
                if let Ok(loaded) = serde_json::from_str::<AppState>(&content) {
                    *wrapper.0.write().expect("state lock") = loaded;
                }
            }
            // Write the state file immediately so the data location exists
            // and is observable from the very first launch.
            {
                let snapshot = wrapper.0.read().expect("state lock").clone();
                let _ = std::fs::write(&path, serde_json::to_string_pretty(&snapshot).expect("serialize"));
            }
            app.manage(wrapper);

            create_tray(app.handle())?;

            // Closing the window hides to tray instead of quitting
            if let Some(window) = app.get_webview_window("main") {
                let window_clone = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = window_clone.hide();
                    }
                });
            }

            // Background loop: water reminders + focus completion
            let handle = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_secs(5));
                reminder_tick(&handle);
                focus_tick(&handle);
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_state,
            save_state,
            toggle_habit,
            add_habit,
            rename_habit,
            delete_habit,
            log_glass,
            undo_glass,
            set_water_goal,
            set_reminder_interval,
            toggle_reminders,
            test_reminder,
            start_pause_focus,
            reset_focus,
            set_focus_duration,
            add_todo,
            toggle_todo,
            remove_todo,
            save_todo_edit,
            play_alarm_sound,
            show_notification,
            set_theme,
        ])
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_notification::NotificationExt;

// ============================================================================
// Data structures
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Habit {
    id: String,
    name: String,
    #[serde(default)]
    created_at: Option<String>, // None = existed forever (seeded five)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct WaterState {
    goal: u32,
    days: HashMap<String, u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RemindersState {
    enabled: bool,
    interval_min: u32,
    next_due_at: Option<u64>, // unix millis
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct FocusSession {
    running: bool,
    end_at: Option<u64>,
    remaining_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct FocusState {
    duration_min: u32,
    days: HashMap<String, u32>,
    session: FocusSession,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Todo {
    id: String,
    text: String,
    due: Option<String>,
    done: bool,
    created_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AppState {
    habits: Vec<Habit>,
    habit_days: HashMap<String, HashMap<String, bool>>,
    water: WaterState,
    reminders: RemindersState,
    focus: FocusState,
    todos: Vec<Todo>,
    #[serde(default)]
    theme: String, // "" = teal
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            // No seeded habits: a fresh install starts empty and the user
            // builds their own list. Nothing personal ships inside the binary.
            habits: Vec::new(),
            habit_days: HashMap::new(),
            water: WaterState { goal: 8, days: HashMap::new() },
            reminders: RemindersState { enabled: false, interval_min: 30, next_due_at: None },
            focus: FocusState {
                duration_min: 25,
                days: HashMap::new(),
                session: FocusSession { running: false, end_at: None, remaining_ms: None },
            },
            todos: Vec::new(),
            theme: String::new(),
        }
    }
}

struct AppStateWrapper(Arc<RwLock<AppState>>);

impl AppStateWrapper {
    fn new() -> Self {
        Self(Arc::new(RwLock::new(AppState::default())))
    }
}

// ============================================================================
// State access — every mutation goes through the in-memory lock, then the
// updated snapshot is persisted. Never mutate a detached clone.
// ============================================================================

fn data_path(app: &AppHandle) -> PathBuf {
    let dir = app.path().app_local_data_dir().expect("app local data dir");
    let _ = std::fs::create_dir_all(&dir);
    dir.join("state.json")
}

fn persist(app: &AppHandle, state: &AppState) {
    let path = data_path(app);
    if let Ok(json) = serde_json::to_string_pretty(state) {
        let _ = std::fs::write(path, json);
    }
}

fn today_key() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

// ============================================================================
// Commands
// ============================================================================

#[tauri::command]
fn get_state(state: State<'_, AppStateWrapper>) -> Result<AppState, String> {
    Ok(state.0.read().map_err(|_| "state lock poisoned")?.clone())
}

#[tauri::command]
fn save_state(app: AppHandle, state: State<'_, AppStateWrapper>) -> Result<(), String> {
    let snapshot = state.0.read().map_err(|_| "state lock poisoned")?.clone();
    persist(&app, &snapshot);
    Ok(())
}

// ----- habits -----

#[tauri::command]
fn toggle_habit(
    app: AppHandle,
    state: State<'_, AppStateWrapper>,
    habit_id: String,
) -> Result<(), String> {
    let snapshot = {
        let mut st = state.0.write().map_err(|_| "state lock poisoned")?;
        let key = today_key();
        let days = st.habit_days.entry(habit_id).or_default();
        if days.contains_key(&key) {
            days.remove(&key);
        } else {
            days.insert(key, true);
        }
        st.clone()
    };
    persist(&app, &snapshot);
    Ok(())
}

#[tauri::command]
fn add_habit(app: AppHandle, state: State<'_, AppStateWrapper>, name: String) -> Result<(), String> {
    let trimmed = name.trim().to_string();
    if trimmed.is_empty() {
        return Err("Empty habit name".into());
    }
    let snapshot = {
        let mut st = state.0.write().map_err(|_| "state lock poisoned")?;
        st.habits.push(Habit {
            id: uuid::Uuid::new_v4().to_string(),
            name: trimmed,
            created_at: Some(today_key()),
        });
        st.clone()
    };
    persist(&app, &snapshot);
    Ok(())
}

#[tauri::command]
fn rename_habit(
    app: AppHandle,
    state: State<'_, AppStateWrapper>,
    habit_id: String,
    name: String,
) -> Result<(), String> {
    let trimmed = name.trim().to_string();
    if trimmed.is_empty() {
        return Err("Empty habit name".into());
    }
    let snapshot = {
        let mut st = state.0.write().map_err(|_| "state lock poisoned")?;
        match st.habits.iter_mut().find(|h| h.id == habit_id) {
            Some(habit) => habit.name = trimmed,
            None => return Err("Habit not found".into()),
        }
        st.clone()
    };
    persist(&app, &snapshot);
    Ok(())
}

#[tauri::command]
fn delete_habit(
    app: AppHandle,
    state: State<'_, AppStateWrapper>,
    habit_id: String,
) -> Result<(), String> {
    let snapshot = {
        let mut st = state.0.write().map_err(|_| "state lock poisoned")?;
        // Deleting is allowed all the way down to zero habits.
        st.habits.retain(|h| h.id != habit_id);
        st.habit_days.remove(&habit_id);
        st.clone()
    };
    persist(&app, &snapshot);
    Ok(())
}

// ----- water -----

#[tauri::command]
fn log_glass(app: AppHandle, state: State<'_, AppStateWrapper>) -> Result<(), String> {
    let snapshot = {
        let mut st = state.0.write().map_err(|_| "state lock poisoned")?;
        *st.water.days.entry(today_key()).or_insert(0) += 1;
        if st.reminders.enabled {
            st.reminders.next_due_at = Some(now_ms() + st.reminders.interval_min as u64 * 60_000);
        }
        st.clone()
    };
    persist(&app, &snapshot);
    Ok(())
}

#[tauri::command]
fn undo_glass(app: AppHandle, state: State<'_, AppStateWrapper>) -> Result<(), String> {
    let snapshot = {
        let mut st = state.0.write().map_err(|_| "state lock poisoned")?;
        let key = today_key();
        if let Some(count) = st.water.days.get_mut(&key) {
            *count -= 1;
            if *count == 0 {
                st.water.days.remove(&key);
            }
        }
        st.clone()
    };
    persist(&app, &snapshot);
    Ok(())
}

#[tauri::command]
fn set_water_goal(app: AppHandle, state: State<'_, AppStateWrapper>, goal: u32) -> Result<(), String> {
    let snapshot = {
        let mut st = state.0.write().map_err(|_| "state lock poisoned")?;
        st.water.goal = goal.clamp(1, 30);
        st.clone()
    };
    persist(&app, &snapshot);
    Ok(())
}

#[tauri::command]
fn set_reminder_interval(
    app: AppHandle,
    state: State<'_, AppStateWrapper>,
    interval_min: u32,
) -> Result<(), String> {
    let snapshot = {
        let mut st = state.0.write().map_err(|_| "state lock poisoned")?;
        st.reminders.interval_min = interval_min.clamp(1, 120);
        if st.reminders.enabled {
            st.reminders.next_due_at = Some(now_ms() + st.reminders.interval_min as u64 * 60_000);
        }
        st.clone()
    };
    persist(&app, &snapshot);
    Ok(())
}

#[tauri::command]
fn toggle_reminders(app: AppHandle, state: State<'_, AppStateWrapper>) -> Result<(), String> {
    let snapshot = {
        let mut st = state.0.write().map_err(|_| "state lock poisoned")?;
        st.reminders.enabled = !st.reminders.enabled;
        st.reminders.next_due_at = if st.reminders.enabled {
            Some(now_ms() + st.reminders.interval_min as u64 * 60_000)
        } else {
            None
        };
        st.clone()
    };
    persist(&app, &snapshot);
    Ok(())
}

#[tauri::command]
fn test_reminder(app: AppHandle) -> Result<(), String> {
    // The frontend plays the buzzer itself; here we fire the OS notification.
    app.notification()
        .builder()
        .title("Test reminder")
        .body("Reminders are working — this is the notification you will get.")
        .show()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn set_theme(app: AppHandle, state: State<'_, AppStateWrapper>, theme: String) -> Result<(), String> {
    const ALLOWED: [&str; 6] = ["", "violet", "rose", "amber", "green", "slate"];
    if !ALLOWED.contains(&theme.as_str()) {
        return Err("Unknown theme".into());
    }
    let snapshot = {
        let mut st = state.0.write().map_err(|_| "state lock poisoned")?;
        st.theme = theme;
        st.clone()
    };
    persist(&app, &snapshot);
    Ok(())
}

// ----- focus -----

#[tauri::command]
fn start_pause_focus(app: AppHandle, state: State<'_, AppStateWrapper>) -> Result<(), String> {
    let snapshot = {
        let mut st = state.0.write().map_err(|_| "state lock poisoned")?;
        let now = now_ms();
        let duration = st.focus.duration_min as u64 * 60_000;
        if st.focus.session.running {
            st.focus.session.remaining_ms =
                st.focus.session.end_at.map(|end| end.saturating_sub(now));
            st.focus.session.running = false;
        } else if let Some(remaining) = st.focus.session.remaining_ms {
            st.focus.session.end_at = Some(now + remaining);
            st.focus.session.running = true;
            st.focus.session.remaining_ms = None;
        } else {
            st.focus.session.running = true;
            st.focus.session.end_at = Some(now + duration);
        }
        st.clone()
    };
    persist(&app, &snapshot);
    Ok(())
}

#[tauri::command]
fn reset_focus(app: AppHandle, state: State<'_, AppStateWrapper>) -> Result<(), String> {
    let snapshot = {
        let mut st = state.0.write().map_err(|_| "state lock poisoned")?;
        st.focus.session = FocusSession { running: false, end_at: None, remaining_ms: None };
        st.clone()
    };
    persist(&app, &snapshot);
    Ok(())
}

#[tauri::command]
fn set_focus_duration(
    app: AppHandle,
    state: State<'_, AppStateWrapper>,
    duration_min: u32,
) -> Result<(), String> {
    let snapshot = {
        let mut st = state.0.write().map_err(|_| "state lock poisoned")?;
        st.focus.duration_min = duration_min.clamp(1, 180);
        st.focus.session = FocusSession { running: false, end_at: None, remaining_ms: None };
        st.clone()
    };
    persist(&app, &snapshot);
    Ok(())
}

// ----- todos -----

#[tauri::command]
fn add_todo(
    app: AppHandle,
    state: State<'_, AppStateWrapper>,
    text: String,
    due: Option<String>,
) -> Result<(), String> {
    let trimmed = text.trim().to_string();
    if trimmed.is_empty() {
        return Err("Empty task".into());
    }
    let snapshot = {
        let mut st = state.0.write().map_err(|_| "state lock poisoned")?;
        st.todos.push(Todo {
            id: uuid::Uuid::new_v4().to_string(),
            text: trimmed,
            due,
            done: false,
            created_at: now_ms(),
        });
        st.clone()
    };
    persist(&app, &snapshot);
    Ok(())
}

#[tauri::command]
fn toggle_todo(app: AppHandle, state: State<'_, AppStateWrapper>, id: String) -> Result<(), String> {
    let snapshot = {
        let mut st = state.0.write().map_err(|_| "state lock poisoned")?;
        match st.todos.iter_mut().find(|t| t.id == id) {
            Some(todo) => todo.done = !todo.done,
            None => return Err("Todo not found".into()),
        }
        st.clone()
    };
    persist(&app, &snapshot);
    Ok(())
}

#[tauri::command]
fn remove_todo(app: AppHandle, state: State<'_, AppStateWrapper>, id: String) -> Result<(), String> {
    let snapshot = {
        let mut st = state.0.write().map_err(|_| "state lock poisoned")?;
        st.todos.retain(|t| t.id != id);
        st.clone()
    };
    persist(&app, &snapshot);
    Ok(())
}

#[tauri::command]
fn save_todo_edit(
    app: AppHandle,
    state: State<'_, AppStateWrapper>,
    id: String,
    text: String,
    due: Option<String>,
) -> Result<(), String> {
    let trimmed = text.trim().to_string();
    if trimmed.is_empty() {
        return Err("Empty task".into());
    }
    let snapshot = {
        let mut st = state.0.write().map_err(|_| "state lock poisoned")?;
        match st.todos.iter_mut().find(|t| t.id == id) {
            Some(todo) => {
                todo.text = trimmed;
                todo.due = due;
            }
            None => return Err("Todo not found".into()),
        }
        st.clone()
    };
    persist(&app, &snapshot);
    Ok(())
}

// ----- utility -----

fn play_system_alarm() {
    #[cfg(target_os = "windows")]
    {
        let _ = unsafe { winapi::um::winuser::MessageBeep(0x30) };
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = std::process::Command::new("sh").arg("-c").arg("printf '\\a'").spawn();
    }
}

#[tauri::command]
fn play_alarm_sound() -> Result<(), String> {
    play_system_alarm();
    Ok(())
}

#[tauri::command]
fn show_notification(app: AppHandle, title: String, body: String) -> Result<(), String> {
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|e| e.to_string())
}

// ============================================================================
// System tray
// ============================================================================

fn create_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::TrayIconBuilder;

    let show_item = MenuItem::with_id(app, "show", "Open Daily Tracker", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

    TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .tooltip("Daily Tracker")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let tauri::tray::TrayIconEvent::DoubleClick { .. } = event {
                if let Some(window) = tray.app_handle().get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)?;

    Ok(())
}

// ============================================================================
// Background loop — reads AND writes the same in-memory state as the
// commands, so a fired reminder is rescheduled exactly once.
// ============================================================================

fn reminder_tick(app: &AppHandle) {
    let state = app.state::<AppStateWrapper>();
    let payload = {
        let mut st = match state.0.write() {
            Ok(g) => g,
            Err(_) => return,
        };
        if !st.reminders.enabled {
            return;
        }
        let now = now_ms();
        let interval = st.reminders.interval_min as u64 * 60_000;
        match st.reminders.next_due_at {
            None => {
                // Enabled but never scheduled — schedule from now, don't fire.
                st.reminders.next_due_at = Some(now + interval);
                let snapshot = st.clone();
                drop(st);
                persist(app, &snapshot);
                return;
            }
            Some(due) if now < due => return,
            Some(_) => {
                // Fire once, then reschedule IN MEMORY so it can't re-fire.
                st.reminders.next_due_at = Some(now + interval);
                let count = st.water.days.get(&today_key()).copied().unwrap_or(0);
                let goal = st.water.goal;
                let message = if count == 0 {
                    "Time for a glass of water.".to_string()
                } else {
                    format!("You've had {} of {} glasses today.", count, goal)
                };
                serde_json::json!({
                    "kind": "water",
                    "title": "Water reminder",
                    "message": message,
                    "count": count,
                    "goal": goal,
                })
            }
        }
    };

    // The OS notification rides along; the loud WebAudio buzzer and the
    // in-page banner are played by the frontend when it receives this event.
    let _ = app.emit("reminder-fired", payload.clone());
    let _ = app
        .notification()
        .builder()
        .title("Water reminder")
        .body(payload["message"].as_str().unwrap_or("Time for a glass of water."))
        .show();
}

fn focus_tick(app: &AppHandle) {
    let state = app.state::<AppStateWrapper>();
    let minutes = {
        let mut st = match state.0.write() {
            Ok(g) => g,
            Err(_) => return,
        };
        if !st.focus.session.running {
            return;
        }
        let now = now_ms();
        match st.focus.session.end_at {
            Some(end) if now >= end => {
                let minutes = st.focus.duration_min;
                st.focus.session = FocusSession { running: false, end_at: None, remaining_ms: None };
                *st.focus.days.entry(today_key()).or_insert(0) += minutes;
                let snapshot = st.clone();
                drop(st);
                persist(app, &snapshot);
                minutes
            }
            _ => return,
        }
    };

    let _ = app.emit("focus-completed", serde_json::json!({ "minutes": minutes }));
    let _ = app
        .notification()
        .builder()
        .title("Focus session complete")
        .body(&format!("{} min added to focus time today — take a short break.", minutes))
        .show();
}