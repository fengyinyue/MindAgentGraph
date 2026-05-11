use anyhow::{anyhow, Result};
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

use crate::BACKEND_PORT;

/// Spawn the bundled Python sidecar (`mag-backend`) and capture the port number
/// it announces on stdout (`PORT=xxxxx`).
///
/// In dev mode, if the bundled binary is missing, falls back to running
/// `python -m app.main` from the backend/ source tree so the dev loop works.
pub fn start_backend(app: &AppHandle) -> Result<()> {
    let shell = app.shell();

    // Try bundled sidecar first
    let cmd_result = shell.sidecar("mag-backend");
    let (mut rx, _child) = match cmd_result {
        Ok(cmd) => cmd
            .spawn()
            .map_err(|e| anyhow!("failed to spawn sidecar: {e}"))?,
        Err(_) => {
            // Dev fallback
            let backend_dir = std::env::current_dir()?
                .parent()
                .ok_or_else(|| anyhow!("cannot find backend dir"))?
                .join("backend");
            shell
                .command("python")
                .args(["-m", "app.main"])
                .current_dir(backend_dir)
                .spawn()
                .map_err(|e| anyhow!("failed to spawn dev python backend: {e}"))?
        }
    };

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let text = String::from_utf8_lossy(&line);
                    if let Some(port_str) = text.trim().strip_prefix("PORT=") {
                        if let Ok(port) = port_str.parse::<u16>() {
                            if let Some(m) = BACKEND_PORT.get() {
                                if let Ok(mut guard) = m.lock() {
                                    *guard = Some(port);
                                }
                            }
                            let _ = app_handle.emit("backend-ready", port);
                        }
                    }
                    eprintln!("[backend] {}", text.trim_end());
                }
                CommandEvent::Stderr(line) => {
                    eprintln!("[backend:err] {}", String::from_utf8_lossy(&line).trim_end());
                }
                CommandEvent::Terminated(payload) => {
                    eprintln!("[backend] terminated: {:?}", payload);
                    break;
                }
                _ => {}
            }
        }
    });

    Ok(())
}
