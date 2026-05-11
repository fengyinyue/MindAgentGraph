//! .mag 工程文件夹的读写。
//!
//! 工程目录布局：
//!   project.mag/
//!     project.json
//!     graphs/main.json     { nodes:[], links:[] }
//!     memory/
//!     assets/
//!     .cache/

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Serialize, Deserialize)]
pub struct ProjectMeta {
    pub name: String,
    pub version: String,
    #[serde(rename = "rootGraph")]
    pub root_graph: String,
    pub description: Option<String>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}

#[derive(Serialize, Deserialize)]
pub struct ProjectPayload {
    pub meta: ProjectMeta,
    pub graph: Value, // nodes + links 原样透传
}

fn ensure_dir(p: &Path) -> Result<()> {
    if !p.exists() {
        fs::create_dir_all(p)?;
    }
    Ok(())
}

#[tauri::command]
pub fn open_project(path: String) -> Result<ProjectPayload, String> {
    open_project_impl(PathBuf::from(path)).map_err(|e| e.to_string())
}

fn open_project_impl(root: PathBuf) -> Result<ProjectPayload> {
    let meta_path = root.join("project.json");
    if !meta_path.exists() {
        return Err(anyhow!(".mag project.json not found: {}", meta_path.display()));
    }
    let meta: ProjectMeta = serde_json::from_str(&fs::read_to_string(&meta_path)?)?;
    let graph_path = root.join(&meta.root_graph);
    let graph: Value = if graph_path.exists() {
        serde_json::from_str(&fs::read_to_string(&graph_path)?)?
    } else {
        serde_json::json!({ "nodes": [], "links": [] })
    };
    Ok(ProjectPayload { meta, graph })
}

#[tauri::command]
pub fn save_project(path: String, payload: ProjectPayload) -> Result<(), String> {
    save_project_impl(PathBuf::from(path), payload).map_err(|e| e.to_string())
}

fn save_project_impl(root: PathBuf, payload: ProjectPayload) -> Result<()> {
    ensure_dir(&root)?;
    ensure_dir(&root.join("graphs"))?;
    ensure_dir(&root.join("memory"))?;
    ensure_dir(&root.join("assets"))?;
    ensure_dir(&root.join(".cache"))?;

    fs::write(
        root.join("project.json"),
        serde_json::to_string_pretty(&payload.meta)?,
    )?;
    fs::write(
        root.join(&payload.meta.root_graph),
        serde_json::to_string_pretty(&payload.graph)?,
    )?;
    Ok(())
}
