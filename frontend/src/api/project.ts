import type { Graph, ProjectMeta } from "@shared/types";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

interface ProjectPayload {
  meta: ProjectMeta;
  graph: Graph;
  path?: string;
}

function ensureTauri(): void {
  if (!isTauri) {
    throw new Error("Open/Save 仅在 Tauri 桌面应用内可用。当前是浏览器 dev 模式。");
  }
}

export async function openProjectDialog(): Promise<ProjectPayload | null> {
  ensureTauri();
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
  ensureTauri();
  const { invoke } = await import("@tauri-apps/api/core");
  const { open } = await import("@tauri-apps/plugin-dialog");
  const dir = await open({
    directory: true,
    multiple: false,
    title: `Choose folder to save ${suggestedName}`,
  });
  if (!dir || typeof dir !== "string") return null;

  const projectPath = `${dir}/${suggestedName}`;
  const meta: ProjectMeta = {
    name: suggestedName.replace(/\.mag$/, ""),
    version: "0.1.0",
    rootGraph: "graphs/main.json",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await invoke("save_project", { path: projectPath, payload: { meta, graph } });
  return projectPath;
}

export async function saveProjectAt(
  path: string,
  meta: ProjectMeta,
  graph: Graph,
): Promise<void> {
  ensureTauri();
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("save_project", {
    path,
    payload: {
      meta: { ...meta, updatedAt: new Date().toISOString() },
      graph,
    },
  });
}
