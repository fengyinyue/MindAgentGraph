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

export interface RunNodeInput {
  node: { title: string; type: string; purpose?: string };
  userPrompt?: string;
  provider?: Provider;
  model?: string;
  apiKey?: string;
}

export interface RunNodeCallbacks {
  onText: (chunk: string) => void;
  onDone: () => void;
  onError: (message: string) => void;
  signal?: AbortSignal;
}

/**
 * POST /run/node — consumes SSE response, dispatching events to callbacks.
 * Resolves when the stream ends (done or error). Use opts.signal to cancel.
 */
export async function runNodeStream(
  input: RunNodeInput,
  cb: RunNodeCallbacks,
): Promise<void> {
  const url = await getBackendUrl();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (input.apiKey) headers["X-Provider-Key"] = input.apiKey;
  const res = await fetch(`${url}/run/node`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      node: input.node,
      userPrompt: input.userPrompt,
      provider: input.provider,
      model: input.model,
    }),
    signal: cb.signal,
  });
  if (!res.ok || !res.body) {
    cb.onError(`/run/node failed: ${res.status}`);
    return;
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      // Split on the SSE event boundary (blank line).
      let idx;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const event = parseSseEvent(raw);
        if (!event) continue;
        if (event.type === "text") {
          try {
            cb.onText(JSON.parse(event.data));
          } catch {
            cb.onText(event.data);
          }
        } else if (event.type === "done") {
          cb.onDone();
          return;
        } else if (event.type === "error") {
          try {
            cb.onError(JSON.parse(event.data).message ?? event.data);
          } catch {
            cb.onError(event.data);
          }
          return;
        }
      }
    }
    cb.onDone();
  } catch (e) {
    if ((e as Error).name === "AbortError") return;
    cb.onError(e instanceof Error ? e.message : String(e));
  }
}

function parseSseEvent(raw: string): { type: string; data: string } | null {
  let type = "message";
  const dataLines: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith("event:")) type = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return null;
  return { type, data: dataLines.join("\n") };
}
