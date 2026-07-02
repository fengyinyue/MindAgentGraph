import { useCallback } from "react";
import { create } from "zustand";
import { cancelCodeRun, expandModules, expandPlan, replayToolSequence, runDagStream, runNodeCode, runNodeStream } from "@/api/backend";
import type { CodeDiffInfo, ExpandPlanResult } from "@/api/backend";
import { collectToolSteps } from "@/utils/toolSteps";
import { useSkillStore } from "@/store/skillStore";
import { useGraphStore } from "@/store/graphStore";
import { useKeyStore } from "@/store/keyStore";
import { useMonitorStore } from "@/store/monitorStore";
import { useProviderStore } from "@/store/providerStore";
import { parseConfirmationRequest } from "@/utils/confirmation";
import { materializeTraceNodes } from "@/utils/traceNodes";
import type { Edge, NodeBase, ToolTraceItem } from "@shared/types";

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
  // Execution nodes keep their result in data.codeOutput (output stays the Explain
  // text). Prefer codeOutput for code nodes so downstream inherits the code result.
  const text = node.type === "code"
    ? (node.data?.codeOutput ?? node.output ?? node.data?.output)
    : (node.output ?? node.data?.output ?? node.data?.codeOutput);
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

function collectUpstreamNodeIds(links: Edge[], nodeId: string): Set<string> {
  const visiting = new Set<string>();
  const result = new Set<string>();
  const visitParents = (id: string) => {
    if (visiting.has(id)) return;
    visiting.add(id);
    for (const link of links.filter((l) => l.target === id)) {
      result.add(link.source);
      visitParents(link.source);
    }
    visiting.delete(id);
  };
  visitParents(nodeId);
  return result;
}

function summarizeNodeForExpand(node: NodeBase) {
  const text = outputText(node).trim();
  return {
    id: node.id,
    type: node.type,
    title: node.title,
    purpose: node.purpose ?? (node.data?.purpose as string | undefined) ?? "",
    hasOutput: text.length > 0,
    outputSummary: text ? text.slice(0, 1200) : undefined,
  };
}

function graphKindForNode(node: NodeBase): "workflow" | "structure" | null {
  if (node.type === "planning") return "workflow";
  if (node.type === "subgraph") return "structure";
  return null;
}

type ExpandedNode = ExpandPlanResult["nodes"][number];
type ExpandedLink = ExpandPlanResult["links"][number];

function hasExplicitDataPorts(node: ExpandedNode): boolean {
  return [node.inputs, node.outputs].some((ports) =>
    Array.isArray(ports) && ports.length > 0,
  );
}

function isDataflowExpansion(nodes: ExpandedNode[], links: ExpandedLink[]): boolean {
  return nodes.some((node) =>
    hasExplicitDataPorts(node) ||
    node.title.startsWith("Input:") ||
    node.title.startsWith("Output:") ||
    node.title.startsWith("Transform:"),
  ) || links.some((link) => Boolean(link.sourceHandle || link.targetHandle));
}

function layoutExpandedNodes(
  nodes: ExpandedNode[],
  links: ExpandedLink[],
  origin: { x: number; y: number },
  direction: "horizontal" | "auto" = "auto",
): Map<string, { x: number; y: number }> {
  const ids = new Set(nodes.map((node) => node.id));
  const incoming = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(nodes.map((node) => [node.id, [] as string[]]));

  for (const link of links) {
    if (!ids.has(link.source) || !ids.has(link.target)) continue;
    outgoing.get(link.source)?.push(link.target);
    incoming.set(link.target, (incoming.get(link.target) ?? 0) + 1);
  }

  const queue = nodes
    .filter((node) => (incoming.get(node.id) ?? 0) === 0)
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((node) => node.id);
  const rank = new Map(nodes.map((node) => [node.id, 0]));
  const remainingIncoming = new Map(incoming);

  while (queue.length) {
    const id = queue.shift()!;
    for (const target of outgoing.get(id) ?? []) {
      rank.set(target, Math.max(rank.get(target) ?? 0, (rank.get(id) ?? 0) + 1));
      remainingIncoming.set(target, (remainingIncoming.get(target) ?? 0) - 1);
      if ((remainingIncoming.get(target) ?? 0) === 0) {
        queue.push(target);
      }
    }
  }

  const horizontal = direction === "horizontal" || isDataflowExpansion(nodes, links);
  const rankGap = horizontal ? 340 : 280;
  const rowGap = horizontal ? 170 : 180;
  const byRank = new Map<number, ExpandedNode[]>();

  for (const node of nodes) {
    const nodeRank = rank.get(node.id) ?? 0;
    byRank.set(nodeRank, [...(byRank.get(nodeRank) ?? []), node]);
  }

  const positions = new Map<string, { x: number; y: number }>();
  for (const [nodeRank, rankNodes] of byRank) {
    const ordered = [...rankNodes].sort((a, b) => a.y - b.y || a.x - b.x || a.title.localeCompare(b.title));
    const centerOffset = ((ordered.length - 1) * rowGap) / 2;
    ordered.forEach((node, index) => {
      if (horizontal) {
        positions.set(node.id, {
          x: origin.x + nodeRank * rankGap,
          y: origin.y + index * rowGap - centerOffset,
        });
      } else {
        positions.set(node.id, {
          x: origin.x + index * rankGap - ((ordered.length - 1) * rankGap) / 2,
          y: origin.y + nodeRank * rowGap,
        });
      }
    });
  }

  return positions;
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

function upsertToolTrace(nodeId: string, runId: string, trace: ToolTraceItem): void {
  const node = useGraphStore.getState().nodes.find((n) => n.id === nodeId);
  if (!node) return;
  const runHistory = (node.runHistory ?? []).map((record) => {
    if (record.id !== runId) return record;
    const existing = record.toolTrace ?? [];
    const found = existing.some((item) => item.id === trace.id);
    return {
      ...record,
      toolTrace: found
        ? existing.map((item) => (item.id === trace.id ? { ...item, ...trace } : item))
        : [...existing, trace],
    };
  });
  useGraphStore.getState().updateNode(nodeId, { runHistory });
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

      if (node.type === "analysis") {
        const projectDir = state.projectDir;
        if (!projectDir) {
          const message = "未设置工程目录，请先在工具栏选择 Project Dir。";
          state.patchNodeData(nodeId, { error: message, status: "error" });
          useMonitorStore.getState().addLog({
            level: "warn",
            source: "node",
            status: "SKIPPED",
            nodeId,
            nodeTitle: node.title,
            message,
          });
          return false;
        }

        const parentOutputs = node.contextMode === "inherit"
          ? collectUpstreamOutputs(state.nodes, state.links, node.id)
          : undefined;
        const provider = useProviderStore.getState().provider;
        const model = useProviderStore.getState().getModel(provider);
        const runRecordId = crypto.randomUUID();
        appendRunRecord(node, {
          id: runRecordId,
          startedAt: new Date().toISOString(),
          status: "running",
          provider,
          model,
        });
        state.patchNodeData(nodeId, { output: "", error: undefined, status: "running" });
        state.updateNode(nodeId, { output: "" });
        useMonitorStore.getState().addLog({
          level: "info",
          source: "node",
          status: "START",
          nodeId,
          nodeTitle: node.title,
          message: `Execution read-only analysis started (${model || "default"})`,
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
            provider,
            model,
            apiKey: useKeyStore.getState().getKey(provider),
            runId,
            readOnly: true,
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
                  message: "Execution read-only analysis receiving output",
                });
              }
              acc += chunk;
              useGraphStore.getState().patchNodeData(nodeId, { output: acc, status: "running" });
              useGraphStore.getState().updateNode(nodeId, { output: acc });
            },
            onFiles: () => { /* read-only analysis does not report changed files */ },
            onToolStart: (trace) => {
              upsertToolTrace(nodeId, runRecordId, trace);
              useMonitorStore.getState().addLog({
                level: "info",
                source: "code",
                status: "TOOL",
                nodeId,
                nodeTitle: node.title,
                message: `${trace.step}. ${trace.tool}`,
              });
            },
            onToolResult: (trace) => {
              upsertToolTrace(nodeId, runRecordId, trace);
              useMonitorStore.getState().addLog({
                level: trace.status === "error" ? "error" : "info",
                source: "code",
                status: trace.status === "error" ? "TOOL_ERROR" : "TOOL_DONE",
                nodeId,
                nodeTitle: node.title,
                message: trace.error ?? `${trace.step}. ${trace.tool} done`,
              });
            },
            onDone: () => {
              finishRunRecord(nodeId, runRecordId, { status: "done", finishedAt: new Date().toISOString() });
              useGraphStore.getState().patchNodeData(nodeId, { status: "done" });
              useMonitorStore.getState().addLog({
                level: "info",
                source: "node",
                status: "DONE",
                nodeId,
                nodeTitle: node.title,
                message: "Execution read-only analysis done",
              });
              setRunning(null);
              if (activeAbort === ctrl) activeAbort = null;
              if (activeCodeRunId === runId) activeCodeRunId = null;
            },
            onError: (message) => {
              ok = false;
              finishRunRecord(nodeId, runRecordId, { status: "error", finishedAt: new Date().toISOString(), error: message });
              useGraphStore.getState().patchNodeData(nodeId, { error: message, status: "error" });
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
              if (activeCodeRunId === runId) activeCodeRunId = null;
            },
            signal: ctrl.signal,
          },
        );
        if (activeCodeRunId === runId) activeCodeRunId = null;
        return ok && !ctrl.signal.aborted;
      }

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

      state.patchNodeData(nodeId, {
        output: "",
        error: undefined,
        confirmation: undefined,
        confirmationAnswers: undefined,
        status: "running",
      });
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
            useGraphStore.getState().patchNodeData(nodeId, { output: acc, status: "running" });
            useGraphStore.getState().updateNode(nodeId, { output: acc });
          },
          onDone: () => {
            finishRunRecord(nodeId, runRecordId, { status: "done", finishedAt: new Date().toISOString() });
            const confirmation = parseConfirmationRequest(acc);
            if (confirmation) {
              ok = false;
              useGraphStore.getState().patchNodeData(nodeId, {
                confirmation,
                confirmationAnswers: {},
                status: "needs_confirmation",
              });
              useMonitorStore.getState().addLog({
                level: "warn",
                source: "node",
                status: "NEEDS_CONFIRMATION",
                nodeId,
                nodeTitle: node.title,
                message: `Node needs ${confirmation.questions.length} confirmation item(s) before continuing`,
              });
            } else {
              useGraphStore.getState().patchNodeData(nodeId, { confirmation: undefined, status: "done" });
            }
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
            useGraphStore.getState().patchNodeData(nodeId, { error: message, status: "error" });
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
          message: "只有 Execution 节点可以运行执行器。",
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
          message: `${provider} API Key 未在前端配置；Execution 节点会尝试使用后端环境变量。`,
        });
      }

      state.patchNodeData(nodeId, {
        codeOutput: "",
        codeError: undefined,
        generatedFiles: undefined,
        codeDiff: undefined,
      });
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
        message: `Execution run started (${model}, fileScope allow ${node.fileScope.allow.length} / deny ${node.fileScope.deny.length})`,
      });
      setRunning(nodeId);

      const ctrl = new AbortController();
      const runId = crypto.randomUUID();
      activeAbort = ctrl;
      activeCodeRunId = runId;
      let acc = "";
      let ok = true;
      let changedFiles: string[] = [];
      let codeDiff: CodeDiffInfo | undefined;

      await runNodeCode(
        {
          node: toRunPayload(node),
          projectDir,
          projectPath: state.projectPath,
          fileScopeAllow: node.fileScope.allow,
          fileScopeDeny: node.fileScope.deny,
          parentOutputs,
          userPrompt: opts.userPrompt,
          provider,
          model,
          apiKey: useKeyStore.getState().getKey(provider),
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
                message: "Execution stream receiving output",
              });
            }
            acc += chunk;
            // Execution result lives in codeOutput only; do not clobber the node's
            // Explain output. outputText() reads codeOutput for code nodes.
            useGraphStore.getState().patchNodeData(nodeId, { codeOutput: acc });
          },
          onFiles: (files) => {
            changedFiles = files;
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
          onDiff: (diff) => {
            codeDiff = diff;
            useGraphStore.getState().patchNodeData(nodeId, { codeDiff: diff });
            useMonitorStore.getState().addLog({
              level: diff.available && diff.diff ? "info" : "warn",
              source: "code",
              status: "DIFF",
              nodeId,
              nodeTitle: node.title,
              message: diff.diff
                ? `Diff captured (${diff.diff.length} chars${diff.truncated ? ", truncated" : ""})`
                : `No diff captured${diff.warnings.length ? `: ${diff.warnings.join("; ")}` : ""}`,
            });
          },
          onToolStart: (trace) => {
            upsertToolTrace(nodeId, runRecordId, trace);
            useMonitorStore.getState().addLog({
              level: "info",
              source: "code",
              status: "TOOL",
              nodeId,
              nodeTitle: node.title,
              message: `${trace.step}. ${trace.tool}`,
            });
          },
          onToolResult: (trace) => {
            upsertToolTrace(nodeId, runRecordId, trace);
            useMonitorStore.getState().addLog({
              level: trace.status === "error" ? "error" : "info",
              source: "code",
              status: trace.status === "error" ? "TOOL_ERROR" : "TOOL_DONE",
              nodeId,
              nodeTitle: node.title,
              message: trace.error ?? `${trace.step}. ${trace.tool} done`,
            });
          },
          onDone: () => {
            finishRunRecord(nodeId, runRecordId, {
              status: "done",
              finishedAt: new Date().toISOString(),
              changedFiles,
              diff: codeDiff?.diff,
              diffTruncated: codeDiff?.truncated,
              diffWarnings: codeDiff?.warnings,
            });
            // Auto-materialize the tool trace into editable/replayable nodes
            // inside this code node (drill in to view; no manual step needed).
            const rec = useGraphStore.getState().nodes
              .find((n) => n.id === nodeId)?.runHistory
              ?.find((r) => r.id === runRecordId);
            materializeTraceNodes(nodeId, rec);
            useMonitorStore.getState().addLog({ level: "info", source: "code", status: "DONE", nodeId, nodeTitle: node.title, message: "Execution run done" });
            setRunning(null);
            if (activeAbort === ctrl) activeAbort = null;
            if (activeCodeRunId === runId) activeCodeRunId = null;
          },
          onError: (message) => {
            ok = false;
            finishRunRecord(nodeId, runRecordId, {
              status: "error",
              finishedAt: new Date().toISOString(),
              error: message,
              changedFiles,
              diff: codeDiff?.diff,
              diffTruncated: codeDiff?.truncated,
              diffWarnings: codeDiff?.warnings,
            });
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

  // Deterministic replay of a code node's materialized tool subgraph (no LLM).
  // Collects child tool nodes, sorts by data.order, replays their toolInput.
  const replayTools = useCallback(
    async (codeNodeId: string, stepNodeIds?: string[]): Promise<boolean> => {
      const state = useGraphStore.getState();
      const codeNode = state.nodes.find((n) => n.id === codeNodeId);
      if (!codeNode) return false;
      if (useRunState.getState().runningId) return false;

      const projectDir = state.projectDir;
      if (!projectDir) {
        const message = "未设置工程目录，请先在工具栏点 📁 选择工程目录";
        useMonitorStore.getState().addLog({ level: "error", source: "code", status: "ERROR", nodeId: codeNodeId, nodeTitle: codeNode.title, message });
        return false;
      }

      const onlyIds = stepNodeIds ? new Set(stepNodeIds) : null;
      const toolNodes = state.nodes
        .filter((n) => n.parentId === codeNodeId && typeof n.data?.tool === "string")
        .filter((n) => !onlyIds || onlyIds.has(n.id))
        .sort((a, b) => Number(a.data?.order ?? 0) - Number(b.data?.order ?? 0));
      if (toolNodes.length === 0) {
        useMonitorStore.getState().addLog({ level: "warn", source: "code", status: "SKIPPED", nodeId: codeNodeId, nodeTitle: codeNode.title, message: "没有可重放的 tool 节点，请先 Render Subgraph。" });
        return false;
      }

      const steps = collectToolSteps(state.nodes, state.links, codeNodeId, onlyIds ?? undefined);

      useMonitorStore.getState().addLog({ level: "info", source: "code", status: "START", nodeId: codeNodeId, nodeTitle: codeNode.title, message: `Tool replay started (${steps.length} steps, no LLM)` });
      setRunning(codeNodeId);
      const ctrl = new AbortController();
      const runId = crypto.randomUUID();
      activeAbort = ctrl;
      activeCodeRunId = runId;
      let ok = true;

      await replayToolSequence(
        {
          projectDir,
          fileScopeAllow: codeNode.fileScope.allow,
          fileScopeDeny: codeNode.fileScope.deny,
          steps,
          runId,
        },
        {
          onText: () => { /* narration only */ },
          onFiles: (files) => {
            useMonitorStore.getState().addLog({ level: "info", source: "code", status: "FILES", nodeId: codeNodeId, nodeTitle: codeNode.title, message: `Files changed: ${files.length ? files.join(", ") : "none"}` });
          },
          onDiff: (diff) => {
            useMonitorStore.getState().addLog({ level: diff.diff ? "info" : "warn", source: "code", status: "DIFF", nodeId: codeNodeId, nodeTitle: codeNode.title, message: diff.diff ? `Diff captured (${diff.diff.length} chars)` : "No diff captured" });
          },
          onToolStart: (trace) => {
            useGraphStore.getState().patchNodeData(trace.id, { status: "running" });
            useMonitorStore.getState().addLog({ level: "info", source: "code", status: "REPLAY", nodeId: codeNodeId, nodeTitle: codeNode.title, message: `${trace.step}. ${trace.tool}` });
          },
          onToolResult: (trace) => {
            useGraphStore.getState().patchNodeData(trace.id, {
              status: trace.status,
              lastOutput: trace.output ?? trace.outputSummary ?? trace.error,
            });
            useMonitorStore.getState().addLog({ level: trace.status === "error" ? "error" : "info", source: "code", status: trace.status === "error" ? "TOOL_ERROR" : "TOOL_DONE", nodeId: codeNodeId, nodeTitle: codeNode.title, message: trace.error ?? `${trace.step}. ${trace.tool} done` });
          },
          onDone: () => {
            useMonitorStore.getState().addLog({ level: "info", source: "code", status: "DONE", nodeId: codeNodeId, nodeTitle: codeNode.title, message: "Tool replay done" });
            setRunning(null);
            if (activeAbort === ctrl) activeAbort = null;
            if (activeCodeRunId === runId) activeCodeRunId = null;
          },
          onError: (message) => {
            ok = false;
            useMonitorStore.getState().addLog({ level: "error", source: "code", status: "ERROR", nodeId: codeNodeId, nodeTitle: codeNode.title, message });
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

  // Run a saved skill: parameterized deterministic replay of its frozen tool
  // subgraph. paramValues override the matching value-node steps by step id.
  const runSkill = useCallback(
    async (skillId: string, paramValues: Record<string, unknown> = {}): Promise<boolean> => {
      const skill = useSkillStore.getState().skills.find((k) => k.id === skillId);
      if (!skill) return false;
      if (useRunState.getState().runningId) return false;

      const state = useGraphStore.getState();
      const projectDir = state.projectDir;
      if (!projectDir) {
        useMonitorStore.getState().addLog({ level: "error", source: "code", status: "ERROR", message: "未设置工程目录，请先在工具栏点 📁 选择工程目录" });
        return false;
      }

      const steps = skill.steps.map((s) =>
        s.tool === "value" && s.id && paramValues[s.id] !== undefined
          ? { ...s, input: { ...s.input, value: paramValues[s.id] } }
          : s,
      );

      useMonitorStore.getState().addLog({ level: "info", source: "code", status: "START", message: `Skill "${skill.name}" started (${steps.length} steps, no LLM)` });
      setRunning(`skill:${skill.id}`);
      const ctrl = new AbortController();
      const runId = crypto.randomUUID();
      activeAbort = ctrl;
      activeCodeRunId = runId;
      let ok = true;

      await replayToolSequence(
        { projectDir, fileScopeAllow: [], fileScopeDeny: [], steps, runId },
        {
          onText: () => {},
          onFiles: (files) => {
            useMonitorStore.getState().addLog({ level: "info", source: "code", status: "FILES", message: `Skill "${skill.name}" changed: ${files.length ? files.join(", ") : "none"}` });
          },
          onDiff: () => {},
          onToolStart: (trace) => {
            useMonitorStore.getState().addLog({ level: "info", source: "code", status: "REPLAY", message: `${skill.name}: ${trace.step}. ${trace.tool}` });
          },
          onToolResult: (trace) => {
            useMonitorStore.getState().addLog({ level: trace.status === "error" ? "error" : "info", source: "code", status: trace.status === "error" ? "TOOL_ERROR" : "TOOL_DONE", message: trace.error ?? `${trace.step}. ${trace.tool} done` });
          },
          onDone: () => {
            useMonitorStore.getState().addLog({ level: "info", source: "code", status: "DONE", message: `Skill "${skill.name}" done` });
            setRunning(null);
            if (activeAbort === ctrl) activeAbort = null;
            if (activeCodeRunId === runId) activeCodeRunId = null;
          },
          onError: (message) => {
            ok = false;
            useMonitorStore.getState().addLog({ level: "error", source: "code", status: "ERROR", message });
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

  // mode controls how a planning node expands:
  //  - "design"  → internal dataflow design (structure expansion, children inside the plan)
  //  - "execute" → external execution nodes (workflow expansion, siblings outside)
  // subgraph nodes always expand as structure regardless of mode.
  const expandPlanNodes = useCallback(
    async (planningNodeId: string, mode: "design" | "execute" = "design"): Promise<boolean> => {
      const state = useGraphStore.getState();
      const planningNode = state.nodes.find((n) => n.id === planningNodeId);
      const baseKind = planningNode ? graphKindForNode(planningNode) : null;
      if (!planningNode || !baseKind) return false;
      const isSubgraphNode = planningNode.type === "subgraph";
      if (planningNode.type === "planning" && mode === "execute") {
        useMonitorStore.getState().addLog({
          level: "warn",
          source: "plan",
          status: "SKIPPED",
          nodeId: planningNodeId,
          nodeTitle: planningNode.title,
          message: "Planning execute expansion is disabled. Use Generate Nodes for the internal design graph.",
        });
        return false;
      }
      // 后端展开族：subgraph 用 structure(扁平数据流)；planning 用 workflow(可含 subgraph)。
      const graphKind: "workflow" | "structure" = isSubgraphNode ? "structure" : "workflow";
      // intoParent: 产物挂进容器内部(设计层) vs 外层兄弟(执行层)。
      const intoParent = isSubgraphNode || mode === "design";
      // 仅 plan 内部设计层允许 subgraph + 深度展开；执行层与 subgraph 内部都不展。
      const expandSubgraphs = !isSubgraphNode && mode === "design";
      if (useRunState.getState().runningId) return false;

      const planText =
        outputText(planningNode).trim() ||
        (planningNode.purpose ?? (planningNode.data?.purpose as string | undefined) ?? "").trim();
      if (!planText) {
        useMonitorStore.getState().addLog({
          level: "warn",
          source: "plan",
          status: "SKIPPED",
          nodeId: planningNodeId,
          nodeTitle: planningNode.title,
          message: "请先填写 Purpose，或点 ▶ Explain 生成规划文本。",
        });
        return false;
      }

      const provider = useProviderStore.getState().provider;
      const model = useProviderStore.getState().getModel(provider);
      const apiKey = useKeyStore.getState().keys[provider];

      useMonitorStore.getState().addLog({
        level: "info",
        source: "plan",
        status: "START",
        nodeId: planningNodeId,
        nodeTitle: planningNode.title,
        message: `Expand plan started with ${provider}/${model}`,
      });
      setRunning(planningNodeId);

      try {
        const upstreamIds = collectUpstreamNodeIds(state.links, planningNodeId);
        const existingNodes = state.nodes
          .filter((n) =>
            upstreamIds.has(n.id) ||
            n.type === "analysis"
          )
          .map(summarizeNodeForExpand);
        const upstreamOutputs = collectUpstreamOutputs(state.nodes, state.links, planningNodeId);
        const result = await expandPlan(planText, {
          graphKind,
          expandSubgraphs,
          provider,
          model,
          apiKey,
          existingNodes,
          upstreamOutputs,
        });

        // Map old AI-generated IDs to new UUIDs
        const idMap = new Map<string, string>();
        for (const raw of result.nodes) {
          idMap.set(raw.id, crypto.randomUUID());
        }

        const positions = layoutExpandedNodes(result.nodes, result.links, {
          x: intoParent ? planningNode.position.x : planningNode.position.x + 360,
          y: intoParent ? planningNode.position.y + 220 : planningNode.position.y,
        }, "horizontal");
        const isWorkflowExpansion = graphKind === "workflow";

        const subgraphRawIds = new Set(
          result.nodes.filter((n) => n.type === "subgraph").map((n) => n.id),
        );
        const childRawIds = new Set(
          result.nodes
            .filter((n) => typeof n.parent_id === "string" && n.parent_id.length > 0)
            .map((n) => n.id),
        );

        const newNodes: NodeBase[] = result.nodes.map((raw) => {
          const isChild = childRawIds.has(raw.id);
          const keepPorts = !isWorkflowExpansion || raw.type === "subgraph" || isChild;
          let nodeParentId: string | undefined;
          if (isChild && raw.parent_id) {
            nodeParentId = idMap.get(raw.parent_id) ?? raw.parent_id;
          } else if (intoParent) {
            nodeParentId = planningNode.id;
          } else {
            nodeParentId = planningNode.parentId;
          }
          // Children of a subgraph live in a separate frame; lay them out
          // relative to (0,0) of that frame so the canvas pans nicely on Enter.
          const fallbackPosition = isChild
            ? { x: raw.x, y: raw.y }
            : intoParent
              ? {
                  x: planningNode.position.x + raw.x,
                  y: planningNode.position.y + 350 + raw.y,
                }
              : {
                  x: planningNode.position.x + 360 + raw.x,
                  y: planningNode.position.y + raw.y,
                };
          return {
            id: idMap.get(raw.id)!,
            type: raw.type as NodeBase["type"],
            title: raw.title,
            position: isChild
              ? fallbackPosition
              : positions.get(raw.id) ?? fallbackPosition,
            contextMode: "inherit" as const,
            fileScope: { allow: [], deny: [] },
            toolPolicy: { tools: [], deny: [] },
            memoryRef: raw.type === "memory" ? `${idMap.get(raw.id)!}.md` : undefined,
            parentId: nodeParentId,
            purpose: raw.purpose ?? "",
            data: {
              purpose: raw.purpose ?? "",
              inputs: keepPorts ? raw.inputs ?? [] : [],
              outputs: keepPorts ? raw.outputs ?? [] : [],
            },
            runHistory: [],
            resourceRefs: [],
            metadata: {},
          };
        });

        const newEdges: Edge[] = result.links.map((raw) => {
          const sourceIsSubgraph = subgraphRawIds.has(raw.source);
          const targetIsSubgraph = subgraphRawIds.has(raw.target);
          const sourceIsChild = childRawIds.has(raw.source);
          const targetIsChild = childRawIds.has(raw.target);
          // Structure-internal edge: both endpoints are children of some subgraph.
          const isStructureEdge = sourceIsChild && targetIsChild;
          const keepSourceHandle =
            !isWorkflowExpansion || sourceIsSubgraph || isStructureEdge;
          const keepTargetHandle =
            !isWorkflowExpansion || targetIsSubgraph || isStructureEdge;
          return {
            id: crypto.randomUUID(),
            source: idMap.get(raw.source) ?? raw.source,
            target: idMap.get(raw.target) ?? raw.target,
            sourceHandle: keepSourceHandle ? raw.sourceHandle : undefined,
            targetHandle: keepTargetHandle ? raw.targetHandle : undefined,
            label: raw.label,
          };
        });

        // Execution layer only: connect planning → sibling root nodes.
        // Design layer (intoParent) keeps nodes inside the plan, no outer connector.
        if (!intoParent) {
          const newTargets = new Set(newEdges.map((e) => e.target));
          const topLevelNodes = newNodes.filter(
            (n) => n.parentId === planningNode.parentId,
          );
          const roots = topLevelNodes.filter((n) => !newTargets.has(n.id));
          for (const root of roots) {
            newEdges.push({
              id: crypto.randomUUID(),
              source: planningNodeId,
              target: root.id,
            });
          }
        }

        const currentState = useGraphStore.getState();
        useGraphStore.getState().setGraph({
          nodes: [...currentState.nodes, ...newNodes],
          links: [...currentState.links, ...newEdges],
        });
        if (intoParent) {
          useGraphStore.getState().enterSubgraph(planningNode.id);
        }

        useMonitorStore.getState().addLog({
          level: "info",
          source: "plan",
          status: "DONE",
          nodeId: planningNodeId,
          nodeTitle: planningNode.title,
          message: `Expanded into ${newNodes.length} nodes / ${newEdges.length} links`,
        });
        return true;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        useMonitorStore.getState().addLog({
          level: "error",
          source: "plan",
          status: "ERROR",
          nodeId: planningNodeId,
          nodeTitle: planningNode.title,
          message,
        });
        return false;
      } finally {
        setRunning(null);
      }
    },
    [setRunning],
  );

  const expandModuleGraph = useCallback(
    async (codeAnalysisNodeId: string): Promise<boolean> => {
      const state = useGraphStore.getState();
      const codeNode = state.nodes.find((n) => n.id === codeAnalysisNodeId);
      if (!codeNode || codeNode.type !== "analysis") return false;
      if (useRunState.getState().runningId) return false;

      const analysisText = outputText(codeNode).trim();
      if (!analysisText) {
        useMonitorStore.getState().addLog({
          level: "warn",
          source: "module-graph",
          status: "SKIPPED",
          nodeId: codeAnalysisNodeId,
          nodeTitle: codeNode.title,
          message: "Analysis 节点还没有 output，请先执行 Analyze Code 生成分析结果。",
        });
        return false;
      }

      const provider = useProviderStore.getState().provider;
      const model = useProviderStore.getState().getModel(provider);
      const apiKey = useKeyStore.getState().keys[provider];

      useMonitorStore.getState().addLog({
        level: "info",
        source: "module-graph",
        status: "START",
        nodeId: codeAnalysisNodeId,
        nodeTitle: codeNode.title,
        message: `Module graph expansion started with ${provider}/${model}`,
      });
      setRunning(codeAnalysisNodeId);

      try {
        const upstreamIds = collectUpstreamNodeIds(state.links, codeAnalysisNodeId);
        const existingNodes = state.nodes
          .filter((n) =>
            upstreamIds.has(n.id) ||
            n.type === "analysis"
          )
          .map(summarizeNodeForExpand);
        const upstreamOutputs = collectUpstreamOutputs(state.nodes, state.links, codeAnalysisNodeId);
        const result = await expandModules(analysisText, {
          provider,
          model,
          apiKey,
          existingNodes,
          upstreamOutputs,
        });

        const idMap = new Map<string, string>();
        for (const raw of result.nodes) {
          idMap.set(raw.id, crypto.randomUUID());
        }

        const positions = layoutExpandedNodes(result.nodes, result.links, {
          x: codeNode.position.x,
          y: codeNode.position.y + 350,
        });

        const newNodes: NodeBase[] = result.nodes.map((raw) => ({
          id: idMap.get(raw.id)!,
          type: raw.type as NodeBase["type"],
          title: raw.title,
          position: positions.get(raw.id) ?? {
            x: codeNode.position.x + raw.x,
            y: codeNode.position.y + 350 + raw.y,
          },
          contextMode: "inherit" as const,
          fileScope: { allow: [], deny: [] },
          toolPolicy: { tools: [], deny: [] },
          memoryRef: raw.type === "memory" ? `${idMap.get(raw.id)!}.md` : undefined,
          parentId: codeAnalysisNodeId,
          purpose: raw.purpose ?? "",
          data: {
            purpose: raw.purpose ?? "",
            inputs: raw.inputs ?? [],
            outputs: raw.outputs ?? [],
          },
          runHistory: [],
          resourceRefs: [],
          metadata: {},
        }));

        const newEdges: Edge[] = result.links.map((raw) => ({
          id: crypto.randomUUID(),
          source: idMap.get(raw.source) ?? raw.source,
          target: idMap.get(raw.target) ?? raw.target,
          sourceHandle: raw.sourceHandle,
          targetHandle: raw.targetHandle,
          label: raw.label,
        }));

        const currentState = useGraphStore.getState();
        useGraphStore.getState().setGraph({
          nodes: [...currentState.nodes, ...newNodes],
          links: [...currentState.links, ...newEdges],
        });

        useMonitorStore.getState().addLog({
          level: "info",
          source: "module-graph",
          status: "DONE",
          nodeId: codeAnalysisNodeId,
          nodeTitle: codeNode.title,
          message: `Expanded into ${newNodes.length} module nodes / ${newEdges.length} links`,
        });
        return true;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        useMonitorStore.getState().addLog({
          level: "error",
          source: "module-graph",
          status: "ERROR",
          nodeId: codeAnalysisNodeId,
          nodeTitle: codeNode.title,
          message,
        });
        return false;
      } finally {
        setRunning(null);
      }
    },
    [setRunning],
  );

  const runDag = useCallback(async (rootNodeId?: string): Promise<boolean> => {
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
    const rootNode = rootNodeId ? state.nodes.find((n) => n.id === rootNodeId) : undefined;
    const runId = crypto.randomUUID();
    const ctrl = new AbortController();

    dagActive = true;
    activeAbort = ctrl;
    useMonitorStore.getState().clearDagProgress();
    useMonitorStore.getState().addLog({
      level: "info", source: "dag", status: "START",
      message: rootNode
        ? `Subtree DAG from "${rootNode.title}" started (${provider})`
        : `DAG run started (${provider})`,
    });

    try {
      let ok = true;
      await runDagStream(
        {
          graph: { nodes: state.nodes, links: state.links },
          projectPath: state.projectPath,
          provider,
          model,
          apiKey,
          allowCode: true,
          rootNodeId,
        },
        {
          onText: (nodeId, chunk) => {
            const node = useGraphStore.getState().nodes.find((n) => n.id === nodeId);
            const next = `${outputText(node)}${chunk}`;
            useGraphStore.getState().patchNodeData(nodeId, { output: next, status: "running" });
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
              const confirmation = parseConfirmationRequest(progress.output);
              useGraphStore.getState().patchNodeData(progress.nodeId, {
                output: progress.output,
                confirmation: confirmation ?? undefined,
                confirmationAnswers: confirmation ? {} : undefined,
                status: confirmation ? "needs_confirmation" : progress.status,
              });
              useGraphStore.getState().updateNode(progress.nodeId, { output: progress.output });
            } else if (progress.status === "needs_confirmation") {
              useGraphStore.getState().patchNodeData(progress.nodeId, { status: "needs_confirmation" });
              ok = false;
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
            useMonitorStore.getState().addLog({
              level: ok ? "info" : "warn",
              source: "dag",
              status: ok ? "DONE" : "PAUSED",
              message: ok ? "DAG run done" : "DAG paused for user confirmation",
            });
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

  return { run, runCode, replayTools, runSkill, expandPlanNodes, expandModuleGraph, runDag, cancel, runningId };
}
