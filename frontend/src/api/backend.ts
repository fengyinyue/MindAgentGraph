import type { ContextMode, Graph } from "@shared/types";
import type { DagProgress, TokenUsage } from "@/store/monitorStore";

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

export type Provider = "anthropic" | "deepseek" | "local-claude" | "local-codex";

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
  node: {
    id?: string;
    title: string;
    type: string;
    purpose?: string;
    contextMode?: ContextMode;
    memoryRef?: string;
    systemPrompt?: string;
  };
  userPrompt?: string;
  parentOutputs?: Record<string, string>;
  projectPath?: string | null;
  provider?: Provider;
  model?: string;
  apiKey?: string;
}

export interface RunNodeCallbacks {
  onText: (chunk: string) => void;
  onDone: () => void;
  onError: (message: string) => void;
  onLog?: (entry: { level?: "info" | "warn" | "error"; source?: string; status?: string; message?: string; nodeId?: string; nodeTitle?: string }) => void;
  onUsage?: (usage: Partial<TokenUsage>) => void;
  onProgress?: (progress: Partial<DagProgress>) => void;
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
      parentOutputs: input.parentOutputs,
      projectPath: input.projectPath,
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
        } else if (event.type === "log") {
          cb.onLog?.(parseJson(event.data, { message: event.data }));
        } else if (event.type === "usage") {
          cb.onUsage?.(parseJson(event.data, {}));
        } else if (event.type === "progress") {
          cb.onProgress?.(parseJson(event.data, {}));
        }
      }
    }
    cb.onDone();
  } catch (e) {
    if ((e as Error).name === "AbortError") return;
    cb.onError(e instanceof Error ? e.message : String(e));
  }
}

export interface CodeRunInput {
  node: {
    id?: string;
    title: string;
    type: string;
    purpose?: string;
    contextMode?: ContextMode;
    memoryRef?: string;
    systemPrompt?: string;
  };
  projectDir: string;
  projectPath?: string | null;
  fileScopeAllow?: string[];
  fileScopeDeny?: string[];
  parentOutputs?: Record<string, string>;
  userPrompt?: string;
  model?: string;
  runId?: string;
}

export interface CodeDiffInfo {
  available: boolean;
  isGitRepo: boolean;
  changedFiles: string[];
  diff: string;
  truncated: boolean;
  warnings: string[];
}

export interface CodeRunCallbacks {
  onText: (chunk: string) => void;
  onFiles: (files: string[]) => void;
  onDiff?: (diff: CodeDiffInfo) => void;
  onDone: () => void;
  onError: (message: string) => void;
  onLog?: RunNodeCallbacks["onLog"];
  onUsage?: RunNodeCallbacks["onUsage"];
  onProgress?: RunNodeCallbacks["onProgress"];
  signal?: AbortSignal;
}

export type CodeAnalysisInput = Omit<CodeRunInput, "runId"> & { runId?: string };

export async function runNodeCode(
  input: CodeRunInput,
  cb: CodeRunCallbacks,
): Promise<void> {
  const url = await getBackendUrl();
  const res = await fetch(`${url}/run/node/code`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal: cb.signal,
  });
  if (!res.ok || !res.body) {
    cb.onError(`/run/node/code failed: ${res.status}`);
    return;
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let idx;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const event = parseSseEvent(raw);
        if (!event) continue;
        if (event.type === "text") {
          try { cb.onText(JSON.parse(event.data)); } catch { cb.onText(event.data); }
        } else if (event.type === "files") {
          try { cb.onFiles(JSON.parse(event.data)); } catch { /* ignore */ }
        } else if (event.type === "diff") {
          cb.onDiff?.(parseJson<CodeDiffInfo>(event.data, {
            available: false,
            isGitRepo: false,
            changedFiles: [],
            diff: "",
            truncated: false,
            warnings: ["Failed to parse diff event."],
          }));
        } else if (event.type === "done") {
          cb.onDone(); return;
        } else if (event.type === "error") {
          try { cb.onError(JSON.parse(event.data).message ?? event.data); } catch { cb.onError(event.data); }
          return;
        } else if (event.type === "log") {
          cb.onLog?.(parseJson(event.data, { message: event.data }));
        } else if (event.type === "usage") {
          cb.onUsage?.(parseJson(event.data, {}));
        } else if (event.type === "progress") {
          cb.onProgress?.(parseJson(event.data, {}));
        }
      }
    }
    cb.onDone();
  } catch (e) {
    if ((e as Error).name === "AbortError") return;
    cb.onError(e instanceof Error ? e.message : String(e));
  }
}

export async function runNodeCodeAnalysis(
  input: CodeAnalysisInput,
  cb: Omit<CodeRunCallbacks, "onFiles" | "onDiff">,
): Promise<void> {
  const url = await getBackendUrl();
  const res = await fetch(`${url}/run/node/code-analysis`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal: cb.signal,
  });
  if (!res.ok || !res.body) {
    cb.onError(`/run/node/code-analysis failed: ${res.status}`);
    return;
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let idx;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const event = parseSseEvent(raw);
        if (!event) continue;
        if (event.type === "text") {
          try { cb.onText(JSON.parse(event.data)); } catch { cb.onText(event.data); }
        } else if (event.type === "done") {
          cb.onDone(); return;
        } else if (event.type === "error") {
          try { cb.onError(JSON.parse(event.data).message ?? event.data); } catch { cb.onError(event.data); }
          return;
        } else if (event.type === "log") {
          cb.onLog?.(parseJson(event.data, { message: event.data }));
        } else if (event.type === "usage") {
          cb.onUsage?.(parseJson(event.data, {}));
        } else if (event.type === "progress") {
          cb.onProgress?.(parseJson(event.data, {}));
        }
      }
    }
    cb.onDone();
  } catch (e) {
    if ((e as Error).name === "AbortError") return;
    cb.onError(e instanceof Error ? e.message : String(e));
  }
}

export interface ProjectScanResult {
  summary: string;
  files: Array<{ path: string; kind: string; reason?: string }>;
  detectedStack: string[];
  suggestedFileScope: {
    allow: string[];
    deny: string[];
  };
  commands: Array<{ name: string; command: string }>;
  warnings: string[];
}

export interface ProjectScanInput {
  node: RunNodeInput["node"];
  projectDir: string;
  projectPath?: string | null;
  fileScopeAllow?: string[];
  fileScopeDeny?: string[];
  maxFiles?: number;
  maxBytesPerFile?: number;
}

export async function scanProject(input: ProjectScanInput): Promise<ProjectScanResult> {
  const url = await getBackendUrl();
  const res = await fetch(`${url}/project/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(`/project/scan failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

export interface ExpandPlanResult {
  nodes: Array<{
    id: string;
    type: string;
    title: string;
    x: number;
    y: number;
    purpose?: string;
  }>;
  links: Array<{
    source: string;
    target: string;
    label?: string;
  }>;
}

export interface ExpandNodeSummary {
  id: string;
  type: string;
  title: string;
  purpose?: string;
  hasOutput: boolean;
  outputSummary?: string;
}

export async function expandPlan(
  planText: string,
  opts: {
    provider?: Provider;
    model?: string;
    apiKey?: string;
    existingNodes?: ExpandNodeSummary[];
    upstreamOutputs?: Record<string, string>;
  } = {},
): Promise<ExpandPlanResult> {
  const url = await getBackendUrl();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.apiKey) headers["X-Provider-Key"] = opts.apiKey;
  const res = await fetch(`${url}/plan/expand`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      plan_text: planText,
      existing_nodes: opts.existingNodes ?? [],
      upstream_outputs: opts.upstreamOutputs ?? {},
      provider: opts.provider,
      model: opts.model,
    }),
  });
  if (!res.ok) {
    throw new Error(`/plan/expand failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

export async function cancelCodeRun(runId: string): Promise<boolean> {
  const url = await getBackendUrl();
  const res = await fetch(`${url}/run/node/code/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ runId }),
  });
  if (!res.ok) return false;
  const data = await res.json() as { cancelled?: boolean };
  return data.cancelled === true;
}

export interface RunDagInput {
  graph: Graph;
  projectPath?: string | null;
  provider?: Provider;
  model?: string;
  apiKey?: string;
  allowCode?: boolean;
}

export interface RunDagCallbacks {
  onText: (nodeId: string, chunk: string) => void;
  onProgress: (progress: DagProgress & { output?: string }) => void;
  onLog: (entry: { level?: "info" | "warn" | "error"; source?: string; status?: string; message?: string; nodeId?: string; nodeTitle?: string }) => void;
  onDone: (results: Record<string, string>) => void;
  onError: (message: string, nodeId?: string) => void;
  signal?: AbortSignal;
}

export async function runDagStream(input: RunDagInput, cb: RunDagCallbacks): Promise<void> {
  const url = await getBackendUrl();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (input.apiKey) headers["X-Provider-Key"] = input.apiKey;
  const res = await fetch(`${url}/run/dag`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      graph: input.graph,
      projectPath: input.projectPath,
      provider: input.provider,
      model: input.model,
      allowCode: input.allowCode ?? false,
    }),
    signal: cb.signal,
  });
  if (!res.ok || !res.body) {
    cb.onError(`/run/dag failed: ${res.status}`);
    return;
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let idx;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const event = parseSseEvent(raw);
        if (!event) continue;
        if (event.type === "text") {
          const data = parseJson<{ nodeId?: string; chunk?: string }>(event.data, {});
          if (data.nodeId && typeof data.chunk === "string") cb.onText(data.nodeId, data.chunk);
        } else if (event.type === "progress") {
          cb.onProgress(parseJson(event.data, {}) as DagProgress & { output?: string });
        } else if (event.type === "log") {
          cb.onLog(parseJson(event.data, { message: event.data }));
        } else if (event.type === "done") {
          const data = parseJson<{ results?: Record<string, string> }>(event.data, {});
          cb.onDone(data.results ?? {});
          return;
        } else if (event.type === "error") {
          const data = parseJson<{ message?: string; nodeId?: string }>(event.data, { message: event.data });
          cb.onError(data.message ?? event.data, data.nodeId);
          return;
        }
      }
    }
    cb.onDone({});
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

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
