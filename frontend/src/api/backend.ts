import type { Graph } from "@shared/types";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

let cachedPort: number | null = null;

async function getBackendUrl(): Promise<string> {
  if (!isTauri) {
    // 浏览器 dev 模式：从 VITE_BACKEND_PORT 读端口（用户手动跑 backend）
    const envPort = (import.meta as { env?: Record<string, string> }).env?.VITE_BACKEND_PORT;
    return `http://127.0.0.1:${envPort ?? "8765"}`;
  }
  if (cachedPort === null) {
    const { invoke } = await import("@tauri-apps/api/core");
    cachedPort = await invoke<number>("get_backend_port");
  }
  return `http://127.0.0.1:${cachedPort}`;
}

export async function checkHealth(): Promise<boolean> {
  try {
    const url = await getBackendUrl();
    const res = await fetch(`${url}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

export type Provider = "anthropic" | "deepseek";

export async function planGraph(
  goal: string,
  opts: { provider?: Provider; model?: string; apiKey?: string } = {},
): Promise<Graph> {
  const url = await getBackendUrl();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.apiKey) headers["X-Provider-Key"] = opts.apiKey;
  const res = await fetch(`${url}/plan`, {
    method: "POST",
    headers,
    body: JSON.stringify({ goal, provider: opts.provider, model: opts.model }),
  });
  if (!res.ok) {
    throw new Error(`/plan failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}
