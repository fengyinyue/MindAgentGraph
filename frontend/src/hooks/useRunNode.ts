import { useCallback } from "react";
import { create } from "zustand";
import { cancelCodeRun, runNodeStream, runNodeCode } from "@/api/backend";
import { useGraphStore } from "@/store/graphStore";
import { useKeyStore } from "@/store/keyStore";
import { useProviderStore } from "@/store/providerStore";
import type { Edge, NodeBase } from "@shared/types";

interface RunState {
  runningId: string | null;
  setRunning: (id: string | null) => void;
}

const useRunState = create<RunState>((set) => ({
  runningId: null,
  setRunning: (id) => set({ runningId: id }),
}));

let activeAbort: AbortController | null = null;
let activeCodeRunId: string | null = null;
let dagActive = false;
let dagCancelled = false;

interface RunOptions {
  userPrompt?: string;
}

function outputText(node: NodeBase): string {
  const text = node.data?.output ?? node.data?.codeOutput;
  return typeof text === "string" ? text : "";
}

function collectUpstreamOutputs(nodes: NodeBase[], links: Edge[], nodeId: string): Record<string, string> | undefined {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const ordered: string[] = [];

  const visitParents = (id: string) => {
    if (visiting.has(id)) return;
    visiting.add(id);
    for (const link of links.filter((l) => l.target === id)) {
      visitParents(link.source);
      if (!visited.has(link.source)) {
        visited.add(link.source);
        ordered.push(link.source);
      }
    }
    visiting.delete(id);
  };

  visitParents(nodeId);

  const outputs: Record<string, string> = {};
  for (const id of ordered) {
    const node = byId.get(id);
    if (!node) continue;
    const text = outputText(node).trim();
    if (text) outputs[`${node.title} (${node.id})`] = text;
  }
  return Object.keys(outputs).length ? outputs : undefined;
}

function topologicalOrder(nodes: NodeBase[], links: Edge[]): string[] {
  const ids = new Set(nodes.map((n) => n.id));
  const indegree = new Map(nodes.map((n) => [n.id, 0]));
  const outgoing = new Map(nodes.map((n) => [n.id, [] as string[]]));

  for (const link of links) {
    if (!ids.has(link.source) || !ids.has(link.target)) continue;
    indegree.set(link.target, (indegree.get(link.target) ?? 0) + 1);
    outgoing.get(link.source)?.push(link.target);
  }

  const queue = nodes.filter((n) => (indegree.get(n.id) ?? 0) === 0).map((n) => n.id);
  const order: string[] = [];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    order.push(id);
    for (const target of outgoing.get(id) ?? []) {
      const next = (indegree.get(target) ?? 0) - 1;
      indegree.set(target, next);
      if (next === 0) queue.push(target);
    }
  }

  if (order.length !== nodes.length) {
    throw new Error("图中存在环，无法进行 DAG 链式执行");
  }
  return order;
}

function toRunPayload(node: NodeBase) {
  return {
    id: node.id,
    title: node.title,
    type: node.type,
    purpose: (node.data?.purpose as string | undefined) ?? "",
    contextMode: node.contextMode,
    memoryRef: node.memoryRef,
    systemPrompt: node.systemPrompt,
  };
}

export function useRunNode() {
  const runningId = useRunState((s) => s.runningId);
  const setRunning = useRunState((s) => s.setRunning);

  const run = useCallback(
    async (nodeId: string, opts: RunOptions = {}): Promise<boolean> => {
      const state = useGraphStore.getState();
      const node = state.nodes.find((n) => n.id === nodeId);
      if (!node) return false;
      if (useRunState.getState().runningId) return false;

      const provider = useProviderStore.getState().provider;
      const apiKey = useKeyStore.getState().keys[provider];
      const parentOutputs = node.contextMode === "inherit"
        ? collectUpstreamOutputs(state.nodes, state.links, node.id)
        : undefined;

      state.patchNodeData(nodeId, { output: "", error: undefined });
      setRunning(nodeId);

      const ctrl = new AbortController();
      activeAbort = ctrl;
      let acc = "";
      let ok = true;

      await runNodeStream(
        {
          node: toRunPayload(node),
          userPrompt: opts.userPrompt,
          parentOutputs,
          projectPath: state.projectPath,
          provider,
          apiKey,
        },
        {
          onText: (chunk) => {
            acc += chunk;
            useGraphStore.getState().patchNodeData(nodeId, { output: acc });
          },
          onDone: () => {
            setRunning(null);
            if (activeAbort === ctrl) activeAbort = null;
          },
          onError: (message) => {
            ok = false;
            useGraphStore.getState().patchNodeData(nodeId, { error: message });
            setRunning(null);
            if (activeAbort === ctrl) activeAbort = null;
          },
          signal: ctrl.signal,
        },
      );
      return ok && !ctrl.signal.aborted;
    },
    [setRunning],
  );

  const runCode = useCallback(
    async (nodeId: string, opts: RunOptions = {}): Promise<boolean> => {
      const state = useGraphStore.getState();
      const node = state.nodes.find((n) => n.id === nodeId);
      if (!node) return false;
      if (useRunState.getState().runningId) return false;

      const projectDir = state.projectDir;
      if (!projectDir) {
        state.patchNodeData(nodeId, { codeError: "未设置工程目录，请先在工具栏选择 Project Dir" });
        return false;
      }

      const parentOutputs = node.contextMode === "inherit"
        ? collectUpstreamOutputs(state.nodes, state.links, node.id)
        : undefined;

      state.patchNodeData(nodeId, { codeOutput: "", codeError: undefined, generatedFiles: undefined });
      setRunning(nodeId);

      const ctrl = new AbortController();
      const runId = crypto.randomUUID();
      activeAbort = ctrl;
      activeCodeRunId = runId;
      let acc = "";
      let ok = true;

      await runNodeCode(
        {
          node: toRunPayload(node),
          projectDir,
          projectPath: state.projectPath,
          fileScopeAllow: node.fileScope.allow,
          fileScopeDeny: node.fileScope.deny,
          parentOutputs,
          userPrompt: opts.userPrompt,
          runId,
        },
        {
          onText: (chunk) => {
            acc += chunk;
            useGraphStore.getState().patchNodeData(nodeId, { codeOutput: acc });
          },
          onFiles: (files) => {
            useGraphStore.getState().patchNodeData(nodeId, { generatedFiles: files });
          },
          onDone: () => {
            setRunning(null);
            if (activeAbort === ctrl) activeAbort = null;
            if (activeCodeRunId === runId) activeCodeRunId = null;
          },
          onError: (message) => {
            ok = false;
            useGraphStore.getState().patchNodeData(nodeId, { codeError: message });
            setRunning(null);
            if (activeAbort === ctrl) activeAbort = null;
            if (activeCodeRunId === runId) activeCodeRunId = null;
          },
          signal: ctrl.signal,
        },
      );
      if (activeCodeRunId === runId) activeCodeRunId = null;
      return ok && !ctrl.signal.aborted;
    },
    [setRunning],
  );

  const runDag = useCallback(async (): Promise<boolean> => {
    if (dagActive || useRunState.getState().runningId) return false;
    const state = useGraphStore.getState();
    const order = topologicalOrder(state.nodes, state.links);
    dagActive = true;
    dagCancelled = false;
    try {
      for (const nodeId of order) {
        if (dagCancelled) return false;
        const node = useGraphStore.getState().nodes.find((n) => n.id === nodeId);
        if (!node) continue;
        const ok = node.type === "code" ? await runCode(nodeId) : await run(nodeId);
        if (!ok) return false;
      }
      return true;
    } finally {
      dagActive = false;
      dagCancelled = false;
    }
  }, [run, runCode]);

  const cancel = useCallback(() => {
    dagCancelled = true;
    const codeRunId = activeCodeRunId;
    if (codeRunId) {
      void cancelCodeRun(codeRunId).finally(() => {
        if (activeCodeRunId === codeRunId) activeCodeRunId = null;
      });
    }
    activeAbort?.abort();
    activeAbort = null;
    setRunning(null);
  }, [setRunning]);

  return { run, runCode, runDag, cancel, runningId };
}
