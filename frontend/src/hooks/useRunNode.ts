import { useCallback } from "react";
import { create } from "zustand";
import { cancelCodeRun, runDagStream, runNodeCode, runNodeStream } from "@/api/backend";
import { useGraphStore } from "@/store/graphStore";
import { useKeyStore } from "@/store/keyStore";
import { useMonitorStore } from "@/store/monitorStore";
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

interface RunOptions {
  userPrompt?: string;
}

function outputText(node: NodeBase | undefined): string {
  if (!node) return "";
  const text = node.output ?? node.data?.output ?? node.data?.codeOutput;
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

function toRunPayload(node: NodeBase) {
  return {
    id: node.id,
    title: node.title,
    type: node.type,
    purpose: node.purpose ?? (node.data?.purpose as string | undefined) ?? "",
    contextMode: node.contextMode,
    memoryRef: node.memoryRef,
    systemPrompt: node.systemPrompt,
  };
}

function appendRunRecord(node: NodeBase, record: NonNullable<NodeBase["runHistory"]>[number]): void {
  useGraphStore.getState().updateNode(node.id, {
    runHistory: [...(node.runHistory ?? []), record],
  });
}

function finishRunRecord(nodeId: string, runId: string, patch: Partial<NonNullable<NodeBase["runHistory"]>[number]>): void {
  const node = useGraphStore.getState().nodes.find((n) => n.id === nodeId);
  if (!node) return;
  useGraphStore.getState().updateNode(nodeId, {
    runHistory: (node.runHistory ?? []).map((record) =>
      record.id === runId ? { ...record, ...patch } : record,
    ),
  });
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
      const model = useProviderStore.getState().getModel(provider);
      const apiKey = useKeyStore.getState().keys[provider];
      if (!apiKey && !provider.startsWith("local-")) {
        useMonitorStore.getState().addLog({
          level: "warn",
          source: "provider",
          status: "WARN",
          nodeId,
          nodeTitle: node.title,
          message: `${provider} API Key 未在前端配置，将使用后端环境变量或离线 demo。`,
        });
      }
      const parentOutputs = node.contextMode === "inherit"
        ? collectUpstreamOutputs(state.nodes, state.links, node.id)
        : undefined;

      state.patchNodeData(nodeId, { output: "", error: undefined });
      state.updateNode(nodeId, { output: "" });
      const runRecordId = crypto.randomUUID();
      appendRunRecord(node, {
        id: runRecordId,
        startedAt: new Date().toISOString(),
        status: "running",
        provider,
        model,
      });
      useMonitorStore.getState().addLog({
        level: "info",
        source: "node",
        status: "START",
        nodeId,
        nodeTitle: node.title,
        message: `Explain started (${provider}/${model}, ${node.contextMode}, fileScope allow ${node.fileScope.allow.length} / deny ${node.fileScope.deny.length})`,
      });
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
          model,
          apiKey,
        },
        {
          onText: (chunk) => {
            if (!acc) {
              useMonitorStore.getState().addLog({
                level: "info",
                source: "node",
                status: "RUNNING",
                nodeId,
                nodeTitle: node.title,
                message: "Explain stream receiving output",
              });
            }
            acc += chunk;
            useGraphStore.getState().patchNodeData(nodeId, { output: acc });
            useGraphStore.getState().updateNode(nodeId, { output: acc });
          },
          onDone: () => {
            finishRunRecord(nodeId, runRecordId, { status: "done", finishedAt: new Date().toISOString() });
            useMonitorStore.getState().addLog({
              level: "info",
              source: "node",
              status: "DONE",
              nodeId,
              nodeTitle: node.title,
              message: "Explain done",
            });
            setRunning(null);
            if (activeAbort === ctrl) activeAbort = null;
          },
          onError: (message) => {
            ok = false;
            finishRunRecord(nodeId, runRecordId, { status: "error", finishedAt: new Date().toISOString(), error: message });
            useGraphStore.getState().patchNodeData(nodeId, { error: message });
            useMonitorStore.getState().addLog({
              level: "error",
              source: "node",
              status: "ERROR",
              nodeId,
              nodeTitle: node.title,
              message,
            });
            setRunning(null);
            if (activeAbort === ctrl) activeAbort = null;
          },
          onLog: (entry) => useMonitorStore.getState().addLog({
            level: entry.level ?? "info",
            source: "node",
            status: entry.status,
            nodeId: entry.nodeId ?? nodeId,
            nodeTitle: entry.nodeTitle ?? node.title,
            message: entry.message ?? "",
          }),
          onUsage: (usage) => useMonitorStore.getState().addTokenUsage({
            provider,
            model: usage.model,
            nodeId,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            totalTokens: usage.totalTokens,
          }),
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
      if (node.type !== "code") {
        useMonitorStore.getState().addLog({
          level: "warn",
          source: "code",
          status: "SKIPPED",
          nodeId,
          nodeTitle: node.title,
          message: "只有 Code 节点可以执行 Run Code。",
        });
        return false;
      }
      if (useRunState.getState().runningId) return false;

      const projectDir = state.projectDir;
      if (!projectDir) {
        const message = "未设置工程目录，请先在工具栏选择 Project Dir";
        state.patchNodeData(nodeId, { codeError: message });
        useMonitorStore.getState().addLog({ level: "error", source: "code", status: "ERROR", nodeId, nodeTitle: node.title, message });
        return false;
      }

      const parentOutputs = node.contextMode === "inherit"
        ? collectUpstreamOutputs(state.nodes, state.links, node.id)
        : undefined;
      const provider = useProviderStore.getState().provider;
      const model = useProviderStore.getState().getModel(provider);
      if (!provider.startsWith("local-") && !useKeyStore.getState().keys[provider]) {
        useMonitorStore.getState().addLog({
          level: "warn",
          source: "provider",
          status: "WARN",
          nodeId,
          nodeTitle: node.title,
          message: `${provider} API Key 未在前端配置；Code 节点依赖本地 CLI 配置。`,
        });
      }

      state.patchNodeData(nodeId, { codeOutput: "", codeError: undefined, generatedFiles: undefined });
      const runRecordId = crypto.randomUUID();
      appendRunRecord(node, {
        id: runRecordId,
        startedAt: new Date().toISOString(),
        status: "running",
        provider,
        model,
      });
      useMonitorStore.getState().addLog({
        level: "info",
        source: "code",
        status: "START",
        nodeId,
        nodeTitle: node.title,
        message: `Code run started (${model}, fileScope allow ${node.fileScope.allow.length} / deny ${node.fileScope.deny.length})`,
      });
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
          model,
          runId,
        },
        {
          onText: (chunk) => {
            if (!acc) {
              useMonitorStore.getState().addLog({
                level: "info",
                source: "code",
                status: "RUNNING",
                nodeId,
                nodeTitle: node.title,
                message: "Code stream receiving output",
              });
            }
            acc += chunk;
            useGraphStore.getState().patchNodeData(nodeId, { codeOutput: acc });
            useGraphStore.getState().updateNode(nodeId, { output: acc });
          },
          onFiles: (files) => {
            useGraphStore.getState().patchNodeData(nodeId, { generatedFiles: files });
            useMonitorStore.getState().addLog({
              level: "info",
              source: "code",
              status: "FILES",
              nodeId,
              nodeTitle: node.title,
              message: `Files changed: ${files.length ? files.join(", ") : "none"}`,
            });
          },
          onDone: () => {
            finishRunRecord(nodeId, runRecordId, { status: "done", finishedAt: new Date().toISOString() });
            useMonitorStore.getState().addLog({ level: "info", source: "code", status: "DONE", nodeId, nodeTitle: node.title, message: "Code run done" });
            setRunning(null);
            if (activeAbort === ctrl) activeAbort = null;
            if (activeCodeRunId === runId) activeCodeRunId = null;
          },
          onError: (message) => {
            ok = false;
            finishRunRecord(nodeId, runRecordId, { status: "error", finishedAt: new Date().toISOString(), error: message });
            useGraphStore.getState().patchNodeData(nodeId, { codeError: message });
            useMonitorStore.getState().addLog({ level: "error", source: "code", status: "ERROR", nodeId, nodeTitle: node.title, message });
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
    const provider = useProviderStore.getState().provider;
    const model = useProviderStore.getState().getModel(provider);
    const apiKey = useKeyStore.getState().keys[provider];
    if (!apiKey && !provider.startsWith("local-")) {
        useMonitorStore.getState().addLog({
          level: "warn",
          source: "provider",
          status: "WARN",
          message: `${provider} API Key 未在前端配置，将使用后端环境变量或离线 demo。`,
      });
    }
    const runId = crypto.randomUUID();
    const ctrl = new AbortController();

    dagActive = true;
    activeAbort = ctrl;
    useMonitorStore.getState().clearDagProgress();
    useMonitorStore.getState().addLog({ level: "info", source: "dag", status: "START", message: `DAG run started (${provider})` });

    try {
      let ok = true;
      await runDagStream(
        {
          graph: { nodes: state.nodes, links: state.links },
          projectPath: state.projectPath,
          provider,
          model,
          apiKey,
          allowCode: false,
        },
        {
          onText: (nodeId, chunk) => {
            const node = useGraphStore.getState().nodes.find((n) => n.id === nodeId);
            const next = `${outputText(node)}${chunk}`;
            useGraphStore.getState().patchNodeData(nodeId, { output: next });
            useGraphStore.getState().updateNode(nodeId, { output: next });
          },
          onProgress: (progress) => {
            useMonitorStore.getState().updateDagProgress({
              runId,
              nodeId: progress.nodeId,
              nodeTitle: progress.nodeTitle,
              status: progress.status,
              message: progress.message,
            });
            if (progress.output !== undefined) {
              useGraphStore.getState().patchNodeData(progress.nodeId, { output: progress.output });
              useGraphStore.getState().updateNode(progress.nodeId, { output: progress.output });
            }
          },
          onLog: (entry) => useMonitorStore.getState().addLog({
            level: entry.level ?? "info",
            source: "dag",
            status: entry.status,
            nodeId: entry.nodeId,
            nodeTitle: entry.nodeTitle,
            message: entry.message ?? "",
          }),
          onDone: () => {
            useMonitorStore.getState().addLog({ level: "info", source: "dag", status: "DONE", message: "DAG run done" });
          },
          onError: (message, nodeId) => {
            ok = false;
            useMonitorStore.getState().addLog({ level: "error", source: "dag", status: "ERROR", nodeId, message });
          },
          signal: ctrl.signal,
        },
      );
      return ok && !ctrl.signal.aborted;
    } finally {
      dagActive = false;
      if (activeAbort === ctrl) activeAbort = null;
    }
  }, []);

  const cancel = useCallback(() => {
    const codeRunId = activeCodeRunId;
    if (codeRunId) {
      void cancelCodeRun(codeRunId).finally(() => {
        if (activeCodeRunId === codeRunId) activeCodeRunId = null;
      });
    }
    activeAbort?.abort();
    activeAbort = null;
    setRunning(null);
    useMonitorStore.getState().addLog({ level: "warn", source: "node", status: "CANCELLED", message: "Run cancelled" });
  }, [setRunning]);

  return { run, runCode, runDag, cancel, runningId };
}
