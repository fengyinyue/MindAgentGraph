mod sidecar;
mod project;

use once_cell::sync::OnceCell;
use std::sync::Mutex;

pub static BACKEND_PORT: OnceCell<Mutex<Option<u16>>> = OnceCell::new();

#[tauri::command]
fn get_backend_port() -> Result<u16, String> {
    BACKEND_PORT
        .get()
        .and_then(|m| m.lock().ok()?.clone())
        .ok_or_else(|| "Backend not started yet".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    BACKEND_PORT.set(Mutex::new(None)).ok();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            sidecar::start_backend(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_backend_port,
            project::open_project,
            project::save_project,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
