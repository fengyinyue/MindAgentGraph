import { create } from "zustand";

export interface MonitorLog {
  id: string;
  timestamp: number;
  level: "info" | "warn" | "error";
  source: "plan" | "node" | "code" | "dag" | "provider" | "module-graph" | "test" | "review";
  status?: string;
  nodeId?: string;
  nodeTitle?: string;
  message: string;
}

export interface TokenUsage {
  id: string;
  timestamp: number;
  provider?: string;
  model?: string;
  nodeId?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface DagProgress {
  runId: string;
  nodeId: string;
  nodeTitle?: string;
  status: "pending" | "running" | "done" | "error" | "skipped" | "needs_confirmation";
  message?: string;
}

interface MonitorState {
  logs: MonitorLog[];
  tokenUsages: TokenUsage[];
  dagProgress: DagProgress[];
  addLog: (entry: Omit<MonitorLog, "id" | "timestamp">) => void;
  addTokenUsage: (usage: Omit<TokenUsage, "id" | "timestamp">) => void;
  updateDagProgress: (progress: DagProgress) => void;
  clearLogs: () => void;
  clearTokenUsages: () => void;
  clearDagProgress: () => void;
  clearAll: () => void;
}

const MAX_LOGS = 300;

export const useMonitorStore = create<MonitorState>((set) => ({
  logs: [],
  tokenUsages: [],
  dagProgress: [],

  addLog: (entry) =>
    set((s) => ({
      logs: [
        ...s.logs.slice(Math.max(0, s.logs.length - MAX_LOGS + 1)),
        { ...entry, id: crypto.randomUUID(), timestamp: Date.now() },
      ],
    })),

  addTokenUsage: (usage) =>
    set((s) => ({
      tokenUsages: [
        ...s.tokenUsages,
        { ...usage, id: crypto.randomUUID(), timestamp: Date.now() },
      ],
    })),

  updateDagProgress: (progress) =>
    set((s) => {
      const idx = s.dagProgress.findIndex((p) => p.runId === progress.runId && p.nodeId === progress.nodeId);
      if (idx === -1) return { dagProgress: [...s.dagProgress, progress] };
      const next = [...s.dagProgress];
      next[idx] = { ...next[idx], ...progress };
      return { dagProgress: next };
    }),

  clearLogs: () => set({ logs: [] }),
  clearTokenUsages: () => set({ tokenUsages: [] }),
  clearDagProgress: () => set({ dagProgress: [] }),
  clearAll: () => set({ logs: [], tokenUsages: [], dagProgress: [] }),
}));
