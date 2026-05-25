import { useCallback } from "react";
import { create } from "zustand";
import { cancelCodeRun, expandModules, expandPlan, runDagStream, runNodeCode, runNodeCodeAnalysis, runNodeStream, scanProject } from "@/api/backend";
import type { CodeDiffInfo } from "@/api/backend";
import { useGraphStore } from "@/store/graphStore";
import { useKeyStore } from "@/store/keyStore";
import { useMonitorStore } from "@/store/monitorStore";
import { useProviderStore } from "@/store/providerStore";
import { parseConfirmationRequest } from "@/utils/confirmation";
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

      if (node.type === "project_scan") {
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

        const runRecordId = crypto.randomUUID();
        appendRunRecord(node, {
          id: runRecordId,
          startedAt: new Date().toISOString(),
          status: "running",
          provider: "project-scan",
        });
        state.patchNodeData(nodeId, { output: "", error: undefined, status: "running" });
        state.updateNode(nodeId, { output: "" });
        useMonitorStore.getState().addLog({
          level: "info",
          source: "node",
          status: "START",
          nodeId,
          nodeTitle: node.title,
          message: `Project scan started (${projectDir})`,
        });
        setRunning(nodeId);

        try {
          const result = await scanProject({
            node: toRunPayload(node),
            projectDir,
            projectPath: state.projectPath,
            fileScopeAllow: node.fileScope.allow,
            fileScopeDeny: node.fileScope.deny,
          });
          useGraphStore.getState().patchNodeData(nodeId, {
            output: result.summary,
            scanResult: result,
            suggestedFileScope: result.suggestedFileScope,
            status: "done",
          });
          useGraphStore.getState().updateNode(nodeId, { output: result.summary });
          finishRunRecord(nodeId, runRecordId, { status: "done", finishedAt: new Date().toISOString() });
          useMonitorStore.getState().addLog({
            level: "info",
            source: "node",
            status: "DONE",
            nodeId,
            nodeTitle: node.title,
            message: `Project scan done (${result.detectedStack.length ? result.detectedStack.join(", ") : "stack unknown"})`,
          });
          return true;
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          useGraphStore.getState().patchNodeData(nodeId, { error: message, status: "error" });
          finishRunRecord(nodeId, runRecordId, { status: "error", finishedAt: new Date().toISOString(), error: message });
          useMonitorStore.getState().addLog({
            level: "error",
            source: "node",
            status: "ERROR",
            nodeId,
            nodeTitle: node.title,
            message,
          });
          return false;
        } finally {
          setRunning(null);
        }
      }

      if (node.type === "code_analysis") {
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
          provider: "claude-code-analysis",
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
          message: `Claude Code analysis started (${model || "default"}, read-only)`,
        });
        setRunning(nodeId);

        const ctrl = new AbortController();
        const runId = crypto.randomUUID();
        activeAbort = ctrl;
        activeCodeRunId = runId;
        let acc = "";
        let ok = true;
        await runNodeCodeAnalysis(
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
                  source: "node",
                  status: "RUNNING",
                  nodeId,
                  nodeTitle: node.title,
                  message: "Claude Code analysis receiving output",
                });
              }
              acc += chunk;
              useGraphStore.getState().patchNodeData(nodeId, { output: acc, status: "running" });
              useGraphStore.getState().updateNode(nodeId, { output: acc });
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
                message: "Claude Code analysis done",
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

      state.patchNodeData(nodeId, { codeOutput: "", codeError: undefined, generatedFiles: undefined, codeDiff: undefined });
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
          onDone: () => {
            finishRunRecord(nodeId, runRecordId, {
              status: "done",
              finishedAt: new Date().toISOString(),
              changedFiles,
              diff: codeDiff?.diff,
              diffTruncated: codeDiff?.truncated,
              diffWarnings: codeDiff?.warnings,
            });
            useMonitorStore.getState().addLog({ level: "info", source: "code", status: "DONE", nodeId, nodeTitle: node.title, message: "Code run done" });
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

  const expandPlanNodes = useCallback(
    async (planningNodeId: string): Promise<boolean> => {
      const state = useGraphStore.getState();
      const planningNode = state.nodes.find((n) => n.id === planningNodeId);
      if (!planningNode || planningNode.type !== "planning") return false;
      if (useRunState.getState().runningId) return false;

      const planText = outputText(planningNode).trim();
      if (!planText) {
        useMonitorStore.getState().addLog({
          level: "warn",
          source: "plan",
          status: "SKIPPED",
          nodeId: planningNodeId,
          nodeTitle: planningNode.title,
          message: "Planning 节点还没有 output，请先 Explain 生成规划文本。",
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
            n.type === "project_scan" ||
            n.type === "code_analysis"
          )
          .map(summarizeNodeForExpand);
        const upstreamOutputs = collectUpstreamOutputs(state.nodes, state.links, planningNodeId);
        const result = await expandPlan(planText, {
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

        const baseX = planningNode.position.x;
        const baseY = planningNode.position.y + 350;

        const newNodes: NodeBase[] = result.nodes.map((raw) => ({
          id: idMap.get(raw.id)!,
          type: raw.type as NodeBase["type"],
          title: raw.title,
          position: { x: baseX + raw.x, y: baseY + raw.y },
          contextMode: raw.type === "project_scan" ? "isolated" as const : "inherit" as const,
          fileScope: { allow: [], deny: [] },
          toolPolicy: { tools: [], deny: [] },
          memoryRef: raw.type === "memory" ? `${idMap.get(raw.id)!}.md` : undefined,
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

        // Find root nodes (no incoming edges from other new nodes) and connect planning → root
        const newTargets = new Set(newEdges.map((e) => e.target));
        const roots = newNodes.filter((n) => !newTargets.has(n.id));
        for (const root of roots) {
          newEdges.push({
            id: crypto.randomUUID(),
            source: planningNodeId,
            target: root.id,
          });
        }

        const currentState = useGraphStore.getState();
        useGraphStore.getState().setGraph({
          nodes: [...currentState.nodes, ...newNodes],
          links: [...currentState.links, ...newEdges],
        });

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
      if (!codeNode || codeNode.type !== "code_analysis") return false;
      if (useRunState.getState().runningId) return false;

      const analysisText = outputText(codeNode).trim();
      if (!analysisText) {
        useMonitorStore.getState().addLog({
          level: "warn",
          source: "module-graph",
          status: "SKIPPED",
          nodeId: codeAnalysisNodeId,
          nodeTitle: codeNode.title,
          message: "Code Analysis 节点还没有 output，请先执行 Analyze Code 生成分析结果。",
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
            n.type === "project_scan" ||
            n.type === "code_analysis"
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

        const baseX = codeNode.position.x;
        const baseY = codeNode.position.y + 350;

        const newNodes: NodeBase[] = result.nodes.map((raw) => ({
          id: idMap.get(raw.id)!,
          type: raw.type as NodeBase["type"],
          title: raw.title,
          position: { x: baseX + raw.x, y: baseY + raw.y },
          contextMode: "inherit" as const,
          fileScope: { allow: [], deny: [] },
          toolPolicy: { tools: [], deny: [] },
          memoryRef: raw.type === "memory" ? `${idMap.get(raw.id)!}.md` : undefined,
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

        const newTargets = new Set(newEdges.map((e) => e.target));
        const roots = newNodes.filter((n) => !newTargets.has(n.id));
        for (const root of roots) {
          newEdges.push({
            id: crypto.randomUUID(),
            source: codeAnalysisNodeId,
            target: root.id,
          });
        }

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

  return { run, runCode, expandPlanNodes, expandModuleGraph, runDag, cancel, runningId };
}
