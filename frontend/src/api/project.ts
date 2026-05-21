import type { Graph, ProjectMeta } from "@shared/types";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const browserProjectHandles = new Map<string, FileSystemDirectoryHandle>();

interface ProjectPayload {
  meta: ProjectMeta;
  graph: Graph;
  path?: string;
}

function ensureBrowserDirectoryPicker(): void {
  if (typeof window === "undefined" || !("showDirectoryPicker" in window)) {
    throw new Error("当前浏览器不支持目录读写。请使用 Chrome/Edge，或改用 Tauri 桌面模式。");
  }
}

function browserPath(handle: FileSystemDirectoryHandle, parent?: FileSystemDirectoryHandle): string {
  return parent ? `${parent.name}/${handle.name}` : handle.name;
}

async function readJsonFile<T>(dir: FileSystemDirectoryHandle, path: string): Promise<T> {
  const parts = path.split("/").filter(Boolean);
  let current = dir;
  for (const part of parts.slice(0, -1)) {
    current = await current.getDirectoryHandle(part);
  }
  const fileHandle = await current.getFileHandle(parts[parts.length - 1]);
  const file = await fileHandle.getFile();
  return JSON.parse(await file.text()) as T;
}

async function writeJsonFile(
  dir: FileSystemDirectoryHandle,
  path: string,
  value: unknown,
): Promise<void> {
  const parts = path.split("/").filter(Boolean);
  let current = dir;
  for (const part of parts.slice(0, -1)) {
    current = await current.getDirectoryHandle(part, { create: true });
  }
  const fileHandle = await current.getFileHandle(parts[parts.length - 1], { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(value, null, 2));
  await writable.close();
}

async function ensureProjectFolders(dir: FileSystemDirectoryHandle): Promise<void> {
  await dir.getDirectoryHandle("graphs", { create: true });
  await dir.getDirectoryHandle("memory", { create: true });
  await dir.getDirectoryHandle("assets", { create: true });
  await dir.getDirectoryHandle(".cache", { create: true });
}

function buildMeta(suggestedName: string): ProjectMeta {
  const now = new Date().toISOString();
  return {
    name: suggestedName.replace(/\.mag$/, ""),
    version: "0.1.0",
    rootGraph: "graphs/main.json",
    createdAt: now,
    updatedAt: now,
  };
}

async function saveProjectToDirectory(
  dir: FileSystemDirectoryHandle,
  meta: ProjectMeta,
  graph: Graph,
): Promise<void> {
  const updatedMeta = { ...meta, updatedAt: new Date().toISOString() };
  await ensureProjectFolders(dir);
  await writeJsonFile(dir, "project.json", updatedMeta);
  await writeJsonFile(dir, updatedMeta.rootGraph, graph);
}

async function openProjectInBrowser(): Promise<ProjectPayload | null> {
  ensureBrowserDirectoryPicker();
  const dir = await window.showDirectoryPicker({ mode: "read" });
  const meta = await readJsonFile<ProjectMeta>(dir, "project.json");
  const graph = await readJsonFile<Graph>(dir, meta.rootGraph);
  const path = browserPath(dir);
  browserProjectHandles.set(path, dir);
  return { meta, graph, path };
}

async function saveProjectInBrowser(
  graph: Graph,
  suggestedName: string,
): Promise<string | null> {
  ensureBrowserDirectoryPicker();
  const parent = await window.showDirectoryPicker({ mode: "readwrite" });
  const projectName = suggestedName.endsWith(".mag") ? suggestedName : `${suggestedName}.mag`;
  const dir = await parent.getDirectoryHandle(projectName, { create: true });
  const meta = buildMeta(projectName);
  await saveProjectToDirectory(dir, meta, graph);
  const path = browserPath(dir, parent);
  browserProjectHandles.set(path, dir);
  return path;
}

export async function openProjectDialog(): Promise<ProjectPayload | null> {
  if (!isTauri) return openProjectInBrowser();

  const { invoke } = await import("@tauri-apps/api/core");
  const { open } = await import("@tauri-apps/plugin-dialog");
  const path = await open({ directory: true, multiple: false, title: "Open .mag Project" });
  if (!path || typeof path !== "string") return null;
  const payload = await invoke<ProjectPayload>("open_project", { path });
  return { ...payload, path };
}

export async function saveProjectDialog(
  graph: Graph,
  suggestedName = "untitled.mag",
): Promise<string | null> {
  if (!isTauri) return saveProjectInBrowser(graph, suggestedName);

  const { invoke } = await import("@tauri-apps/api/core");
  const { open } = await import("@tauri-apps/plugin-dialog");
  const dir = await open({
    directory: true,
    multiple: false,
    title: `Choose folder to save ${suggestedName}`,
  });
  if (!dir || typeof dir !== "string") return null;

  const projectPath = `${dir}/${suggestedName}`;
  const meta = buildMeta(suggestedName);
  await invoke("save_project", { path: projectPath, payload: { meta, graph } });
  return projectPath;
}

export async function saveProjectAt(
  path: string,
  meta: ProjectMeta,
  graph: Graph,
): Promise<void> {
  if (!isTauri) {
    const dir = browserProjectHandles.get(path);
    if (!dir) {
      throw new Error("浏览器模式无法通过路径直接写入。请使用 Save As 重新选择目录并授权。");
    }
    await saveProjectToDirectory(dir, meta, graph);
    return;
  }

  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("save_project", {
    path,
    payload: {
      meta: { ...meta, updatedAt: new Date().toISOString() },
      graph,
    },
  });
}
