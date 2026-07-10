import { useGraphStore } from "@/store/graphStore";
import { useRunNode } from "@/hooks/useRunNode";
import type { CodeExecutionEngine } from "@/api/backend";
import { useOutputPanelStore } from "@/store/outputPanelStore";
import { useMonitorStore } from "@/store/monitorStore";
import { MarkdownPreview } from "@/components/OutputViewer";
import {
  buildConfirmationPrompt,
  type ConfirmationAnswers,
  type ConfirmationRequest,
} from "@/utils/confirmation";
import { allowedNodeTypes, type DataPort, type DataPortType, type NodeBase, type NodeType, type ToolTraceItem } from "@shared/types";
import { toolSpec, TOOL_REGISTRY } from "@/toolRegistry";
import { useSkillStore } from "@/store/skillStore";
import { collectToolSteps } from "@/utils/toolSteps";
import { tracePurpose } from "@/utils/traceNodes";
import { defaultSystemPromptForNodeType } from "@/utils/defaultSystemPrompts";
import {
  collectResolvedInputs,
  listJsonOutputFields,
  listMarkdownSections,
  resolveOutputPort,
  type ResolvedInput,
  type ResolvedOutput,
} from "@/utils/resolvedInputs";

function nodeTypeLabel(type: NodeType): string {
  if (type === "prompt") return "Requirement";
  if (type === "planning") return "Design";
  if (type === "subgraph") return "Subgraph";
  if (type === "analysis") return "Analysis";
  if (type === "code") return "Execution";
  if (type === "test") return "Test";
  return type;
}

const DATA_PORT_TYPES: DataPortType[] = [
  "unknown",
  "graph",
  "asset",
  "debug",
  "spline",
  "point",
  "polygon",
  "bounds",
];

const DEFAULT_PORTS_BY_TYPE: Record<NodeType, { inputs: DataPort[]; outputs: DataPort[] }> = {
  prompt: {
    inputs: [{ id: "context", name: "Context", type: "unknown" }],
    outputs: [{ id: "response", name: "Response", type: "unknown" }],
  },
  planning: {
    inputs: [{ id: "context", name: "Context", type: "unknown" }],
    outputs: [{ id: "plan", name: "Plan", type: "unknown" }],
  },
  subgraph: {
    inputs: [{ id: "context", name: "Context", type: "unknown" }],
    outputs: [{ id: "structure", name: "Structure", type: "graph" }],
  },
  subgraph_input: {
    inputs: [],
    outputs: [{ id: "input", name: "Input", type: "unknown" }],
  },
  subgraph_output: {
    inputs: [{ id: "output", name: "Output", type: "unknown" }],
    outputs: [],
  },
  memory: {
    inputs: [{ id: "context", name: "Context", type: "unknown" }],
    outputs: [{ id: "memory", name: "Memory", type: "unknown" }],
  },
  filescope: {
    inputs: [{ id: "context", name: "Context", type: "unknown" }],
    outputs: [{ id: "file_scope", name: "File Scope", type: "unknown" }],
  },
  analysis: {
    inputs: [{ id: "project", name: "Project", type: "unknown" }],
    outputs: [{ id: "analysis", name: "Analysis", type: "unknown" }],
  },
  code: {
    inputs: [{ id: "context", name: "Context", type: "unknown" }],
    outputs: [{ id: "result", name: "Result", type: "unknown" }],
  },
  api: {
    inputs: [{ id: "request", name: "Request", type: "unknown" }],
    outputs: [{ id: "response", name: "Response", type: "unknown" }],
  },
  asset: {
    inputs: [{ id: "context", name: "Context", type: "unknown" }],
    outputs: [{ id: "asset", name: "Asset", type: "asset" }],
  },
  agent: {
    inputs: [{ id: "context", name: "Context", type: "unknown" }],
    outputs: [{ id: "result", name: "Result", type: "unknown" }],
  },
  test: {
    inputs: [{ id: "context", name: "Context", type: "unknown" }],
    outputs: [{ id: "test_report", name: "Test Report", type: "unknown" }],
  },
  task: {
    inputs: [{ id: "context", name: "Context", type: "unknown" }],
    outputs: [{ id: "result", name: "Result", type: "unknown" }],
  },
  tool: {
    inputs: [{ id: "in", name: "In", type: "unknown" }],
    outputs: [{ id: "out", name: "Out", type: "unknown" }],
  },
  semantic: {
    inputs: [{ id: "context", name: "Context", type: "unknown" }],
    outputs: [{ id: "result", name: "Result", type: "unknown" }],
  },
};

function isDataPortType(value: unknown): value is DataPortType {
  return typeof value === "string" && DATA_PORT_TYPES.includes(value as DataPortType);
}

function portIdFromName(name: string, fallback: string): string {
  const id = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_ -]/g, "")
    .replace(/[\s-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return id || fallback;
}

function normalizeInspectorPorts(value: unknown, fallbackPrefix: "input" | "output"): DataPort[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw, index): DataPort[] => {
    if (typeof raw === "string") {
      return [{ id: `${fallbackPrefix}_${index + 1}`, name: raw, type: "unknown" }];
    }
    if (!raw || typeof raw !== "object") return [];
    const candidate = raw as Partial<DataPort>;
    const name = typeof candidate.name === "string" && candidate.name.trim()
      ? candidate.name
      : typeof candidate.id === "string" && candidate.id.trim()
        ? candidate.id
        : `${fallbackPrefix} ${index + 1}`;
    return [{
      id: typeof candidate.id === "string" && candidate.id.trim()
        ? candidate.id
        : portIdFromName(name, `${fallbackPrefix}_${index + 1}`),
      name,
      type: isDataPortType(candidate.type) ? candidate.type : "unknown",
    }];
  });
}

function editablePorts(node: NodeBase): { inputs: DataPort[]; outputs: DataPort[] } {
  const inputs = normalizeInspectorPorts(node.data?.inputs, "input");
  const outputs = normalizeInspectorPorts(node.data?.outputs, "output");
  if (node.data?.portsCustomized === true || inputs.length || outputs.length) {
    return { inputs, outputs };
  }
  return DEFAULT_PORTS_BY_TYPE[node.type] ?? DEFAULT_PORTS_BY_TYPE.task;
}

export type InspectorView = "props" | "input" | "output" | "scope";

export default function NodeInspector({ view = "props" }: { view?: InspectorView } = {}) {
  const selectedId = useGraphStore((s) => s.selectedNodeId);
  const node = useGraphStore((s) =>
    s.nodes.find((n) => n.id === selectedId),
  );
  const nodes = useGraphStore((s) => s.nodes);
  const links = useGraphStore((s) => s.links);
  // Layer of the selected node = type of its container (Phase 3 type vocabulary).
  const parentType = useGraphStore((s) => {
    const self = s.nodes.find((n) => n.id === selectedId);
    if (!self?.parentId) return null;
    return s.nodes.find((n) => n.id === self.parentId)?.type ?? null;
  });
  const {
    run,
    runCode,
    exportDesignDocument,
    runTestNode,
    replayTools,
    runSkill,
    expandPlanNodes,
    expandModuleGraph,
    cancel,
    runningId,
  } = useRunNode();
  const updateNode = useGraphStore((s) => s.updateNode);
  const updateLinks = useGraphStore((s) => s.updateLinks);
  const projectDir = useGraphStore((s) => s.projectDir);
  const projectPath = useGraphStore((s) => s.projectPath);
  const enterSubgraph = useGraphStore((s) => s.enterSubgraph);
  const openOutputPanel = useOutputPanelStore((s) => s.open);
  const skills = useSkillStore((s) => s.skills);

  if (!node) {
    return (
      <div className="p-4 text-zinc-500 text-sm">
        选择一个节点查看上下文 / Memory / 文件作用域。右键节点可以运行。
      </div>
    );
  }

  const isRunning = runningId === node.id;
  const output = node.output ?? (node.data?.output as string | undefined) ?? "";
  const codeOutput = (node.data?.codeOutput as string | undefined) ?? "";
  const error = (node.data?.error as string | undefined) ?? "";
  const codeError = (node.data?.codeError as string | undefined) ?? "";
  const purpose = node.purpose ?? (node.data?.purpose as string | undefined) ?? "";
  const generatedFiles = (node.data?.generatedFiles as string[] | undefined) ?? [];
  const codeDiff = node.data?.codeDiff as { diff?: string; truncated?: boolean; warnings?: string[] } | undefined;
  const latestRun = node.runHistory?.[node.runHistory.length - 1];
  const toolTrace = latestRun?.toolTrace ?? [];
  const customSystemPrompt = node.systemPrompt ?? "";
  const systemPrompt = customSystemPrompt.trim() ? customSystemPrompt : defaultSystemPromptForNodeType(node.type);
  const memoryRef = node.memoryRef ?? "";
  const isCodeNode = node.type === "code";
  const executionEngine: CodeExecutionEngine = node.data?.executionEngine === "native-tools" ? "native-tools" : "claude-code";
  const isToolNode = node.type === "tool";
  const isGraphNode = node.type === "planning" || node.type === "subgraph";
  const isCodeAnalysisNode = node.type === "analysis";
  const isPlanningNode = node.type === "planning";
  const isTaskNode = node.type === "task";
  const isTestNode = node.type === "test";
  const canGenerateNodes = node.type === "subgraph";
  const canGenerateModuleGraph = isCodeAnalysisNode && output.trim().length > 0;
  const confirmation = getConfirmationRequest(node.data?.confirmation);
  const confirmationAnswers = getConfirmationAnswers(node.data?.confirmationAnswers);
  const needsConfirmation = node.data?.status === "needs_confirmation" && confirmation !== null;
  const ports = editablePorts(node);
  const resolvedInputs = collectResolvedInputs(nodes, links, node.id);
  const resolvedOutputs = ports.outputs.map((port) => resolveOutputPort(node, port));
  const contractText = codeOutput || output;
  const markdownSections = listMarkdownSections(contractText);
  const jsonFields = listJsonOutputFields(contractText);

  const commitPorts = (
    direction: "inputs" | "outputs",
    nextPorts: DataPort[],
    changed?: { oldId: string; newId?: string },
  ) => {
    useGraphStore.getState().patchNodeData(node.id, {
      inputs: direction === "inputs" ? nextPorts : ports.inputs,
      outputs: direction === "outputs" ? nextPorts : ports.outputs,
      portsCustomized: true,
    });
    if (!changed) return;
    updateLinks((links) => {
      if (!changed.newId) {
        return links.filter((link) =>
          direction === "inputs"
            ? !(link.target === node.id && link.targetHandle === changed.oldId)
            : !(link.source === node.id && link.sourceHandle === changed.oldId),
        );
      }
      return links.map((link) => {
        if (direction === "inputs" && link.target === node.id && link.targetHandle === changed.oldId) {
          return { ...link, targetHandle: changed.newId };
        }
        if (direction === "outputs" && link.source === node.id && link.sourceHandle === changed.oldId) {
          return { ...link, sourceHandle: changed.newId };
        }
        return link;
      });
    });
  };

  // Save this code node's tool subgraph as a reusable, parameterized skill.
  const saveAsSkill = () => {
    const state = useGraphStore.getState();
    const steps = collectToolSteps(state.nodes, state.links, node.id);
    if (steps.length === 0) {
      useMonitorStore.getState().addLog({ level: "warn", source: "code", status: "SKIPPED", nodeId: node.id, nodeTitle: node.title, message: "没有可保存的 tool 子图，请先 Render Subgraph。" });
      return;
    }
    const params = steps
      .filter((s) => s.tool === "value")
      .map((s) => {
        const vn = state.nodes.find((n) => n.id === s.id);
        return { stepId: s.id as string, name: vn?.title || (s.id as string), default: (s.input as Record<string, unknown>).value };
      });
    useSkillStore.getState().saveSkill({
      id: crypto.randomUUID(),
      name: node.title || "Skill",
      createdAt: new Date().toISOString(),
      steps,
      params,
    });
    useMonitorStore.getState().addLog({ level: "info", source: "code", status: "DONE", nodeId: node.id, nodeTitle: node.title, message: `已保存为技能 "${node.title}"（${params.length} 个参数）` });
  };

  const updateConfirmationAnswer = (id: string, value: string) => {
    useGraphStore.getState().patchNodeData(node.id, {
      confirmationAnswers: { ...confirmationAnswers, [id]: value },
    });
  };

  const promoteTrace = (trace: ToolTraceItem) => {
    const store = useGraphStore.getState();
    const promoted: NodeBase = {
      id: crypto.randomUUID(),
      type: "tool",
      title: `${trace.tool}: ${node.title}`,
      position: {
        x: node.position.x + 320,
        y: node.position.y + trace.step * 80,
      },
      contextMode: "inherit",
      fileScope: node.fileScope,
      toolPolicy: { tools: [], deny: [] },
      parentId: node.parentId,
      purpose: tracePurpose(trace),
      data: {
        purpose: tracePurpose(trace),
        tool: trace.tool,
        toolInput: trace.input ?? {},
        order: trace.step,
        status: trace.status,
        lastOutput: trace.output ?? trace.outputSummary,
        promotedFromTrace: {
          sourceNodeId: node.id,
          runId: latestRun?.id,
          trace,
        },
      },
      runHistory: [],
      resourceRefs: [],
      metadata: {
        promotedFromTrace: true,
        traceSourceNodeId: node.id,
        traceRunId: latestRun?.id,
        traceToolId: trace.id,
      },
    };
    store.addNode(promoted);
    store.addLink({
      id: crypto.randomUUID(),
      source: node.id,
      target: promoted.id,
      label: `promoted ${trace.tool}`,
    });
    store.selectNode(promoted.id);
  };

  const continueWithConfirmation = () => {
    if (!confirmation) return;
    void run(node.id, {
      userPrompt: buildConfirmationPrompt(confirmation, confirmationAnswers),
    });
  };

  if (view === "props") {
    return (
      <div className="flex flex-col h-full text-sm overflow-y-auto">
        <div className="p-3 space-y-3">
          <div className="col-span-4 min-w-0">
            <div className="text-[10px] text-zinc-500 uppercase tracking-wide">Title</div>
            <input
              className="mag-input mt-0.5 w-full px-2 py-1 text-xs"
              value={node.title}
              onChange={(e) => updateNode(node.id, { title: e.target.value })}
            />
          </div>
          <div className="col-span-2 min-w-0">
            <div className="text-[10px] text-zinc-500 uppercase tracking-wide">Type</div>
            <select
              className="mag-input mt-0.5 w-full px-1.5 py-1 text-xs"
              value={node.type}
              onChange={(e) => updateNode(node.id, { type: e.target.value as NodeType })}
            >
              {Array.from(new Set([node.type, ...allowedNodeTypes(parentType)])).map((nt) => (
                <option key={nt} value={nt}>{nodeTypeLabel(nt)}</option>
              ))}
            </select>
          </div>
          <div className="col-span-2 min-w-0">
            <div className="text-[10px] text-zinc-500 uppercase tracking-wide">Context</div>
            <select
              className="mag-input mt-0.5 w-full px-1.5 py-1 text-xs"
              value={node.contextMode}
              onChange={(e) => updateNode(node.id, { contextMode: e.target.value as "inherit" | "explicit" | "isolated" })}
              title={contextHint(node.contextMode)}
            >
              <option value="inherit">inherit</option>
              <option value="explicit">explicit</option>
              <option value="isolated">isolated</option>
            </select>
          </div>
          <div className="col-span-4 min-w-0">
            <div className="text-[10px] text-zinc-500 uppercase tracking-wide">Memory Ref</div>
            <input
              className="mag-input mt-0.5 w-full px-2 py-1 font-mono text-xs"
              value={memoryRef}
              placeholder="architecture.md"
              onChange={(e) => updateNode(node.id, { memoryRef: e.target.value || undefined })}
            />
          </div>

          <div className="col-span-6 min-w-0">
            <div className="text-[10px] text-zinc-500 uppercase tracking-wide">Purpose / Node Prompt</div>
            <textarea
              className="mag-input mt-0.5 min-h-14 w-full resize-y px-2 py-1 text-xs"
              rows={3}
              value={purpose}
              placeholder="这个节点自己的任务说明"
              onChange={(e) => {
                updateNode(node.id, { purpose: e.target.value });
                useGraphStore.getState().patchNodeData(node.id, { purpose: e.target.value });
              }}
            />
          </div>
          <div className="col-span-6 min-w-0">
            <div className="flex items-center gap-2">
              <div className="text-[10px] text-zinc-500 uppercase tracking-wide">System Prompt</div>
              <span className="text-[10px] text-zinc-600">{customSystemPrompt.trim() ? "custom" : "default"}</span>
            </div>
            <textarea
              className="mag-input mt-0.5 min-h-14 w-full resize-y px-2 py-1 text-xs"
              rows={3}
              value={systemPrompt}
              onChange={(e) => {
                const next = e.target.value;
                updateNode(node.id, {
                  systemPrompt: next.trim() && next !== defaultSystemPromptForNodeType(node.type) ? next : undefined,
                });
              }}
            />
          </div>

          <div className="min-w-0 border-t border-zinc-800/60 pt-2">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-[10px] text-zinc-500 uppercase tracking-wide">Ports</span>
              <span className="text-[10px] text-zinc-600">
                semantic labels and connection anchors
              </span>
            </div>
            <div className="space-y-3">
              <PortEditor
                title="Inputs"
                direction="inputs"
                ports={ports.inputs}
                onChange={(next, changed) => commitPorts("inputs", next, changed)}
              />
              <PortEditor
                title="Outputs"
                direction="outputs"
                ports={ports.outputs}
                onChange={(next, changed) => commitPorts("outputs", next, changed)}
              />
            </div>
          </div>

          <div className="col-span-12 flex flex-wrap gap-2 pt-1 border-t border-zinc-800/60">
            {isRunning ? (
              <button className="mag-button border-red-700/70 text-red-300 hover:border-red-500 hover:text-red-200" onClick={cancel}>
                ■ Cancel
              </button>
            ) : (
              <>
                <button
                  className="mag-button mag-button-primary"
                  onClick={() => run(node.id)}
                  disabled={runningId !== null || (isCodeAnalysisNode && !projectDir)}
                  title={isCodeAnalysisNode && !projectDir ? "请先在工具栏选择 Project Dir" : undefined}
                >
                  {isCodeAnalysisNode ? "◇ Analyze Code" : "▶ Explain"}
                </button>
                {isPlanningNode ? (
                  <button
                    className="mag-button"
                    onClick={() => exportDesignDocument(node.id)}
                    disabled={runningId !== null}
                    title="Export this Design node's current output as a Markdown document."
                  >
                    Export Document
                  </button>
                ) : null}
                {canGenerateNodes ? (
                  <button
                    className="mag-button"
                    onClick={() => expandPlanNodes(node.id, "design")}
                    disabled={runningId !== null}
                    title="Generate internal structure nodes for this Subgraph."
                  >
                    ✦ Generate Nodes
                  </button>
                ) : null}
                {isTestNode ? (
                  <button
                    className="mag-button"
                    onClick={() => runTestNode(node.id)}
                    disabled={runningId !== null || !projectDir}
                    title={!projectDir ? "Select Project Dir before running tests." : "Run the configured whitelisted test command without LLM."}
                  >
                    Run Test
                  </button>
                ) : null}
                {canGenerateModuleGraph ? (
                  <button
                    className="mag-button"
                    onClick={() => expandModuleGraph(node.id)}
                    disabled={runningId !== null}
                  >
                    ⬡ Module Graph
                  </button>
                ) : null}
                {isCodeAnalysisNode ? (
                  <button
                    className="mag-button"
                    onClick={() => enterSubgraph(node.id)}
                    disabled={runningId !== null}
                  >
                    Enter Analysis
                  </button>
                ) : null}
                {isGraphNode ? (
                  <button
                    className="mag-button"
                    onClick={() => enterSubgraph(node.id)}
                    disabled={runningId !== null}
                  >
                    Enter
                  </button>
                ) : null}
                {isCodeNode ? (
                  <>
                    <button
                      className="mag-button mag-button-primary"
                      onClick={() => runCode(node.id)}
                      disabled={runningId !== null || !projectDir}
                      title={!projectDir ? "请先在工具栏点 📁 选择工程目录" : executionEngine === "claude-code" ? "Claude Code Execution Runner" : "MAG Native Execution Runner"}
                    >
                      ⚡ Execution
                    </button>
                    <button
                      className="mag-button"
                      onClick={() => enterSubgraph(node.id)}
                      disabled={runningId !== null}
                    >
                      Enter Execution
                    </button>
                  </>
                ) : null}
              </>
            )}
            <span className="ml-auto text-[10px] text-zinc-600 self-center">
              {contextHint(node.contextMode)}
            </span>
          </div>

          {isToolNode ? (
            <div className="col-span-12 min-w-0 border-t border-zinc-800/60 pt-2 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-zinc-500 uppercase tracking-wide">Tool</span>
                <select
                  className="mag-input px-1.5 py-0.5 text-xs"
                  value={String(node.data?.tool ?? "")}
                  onChange={(e) =>
                    useGraphStore.getState().patchNodeData(node.id, { tool: e.target.value })
                  }
                >
                  <option value="">（选择工具）</option>
                  {Object.keys(TOOL_REGISTRY).map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
                {toolSpec(String(node.data?.tool ?? ""))?.writes ? (
                  <span className="text-[10px] text-amber-400 border border-amber-700/60 rounded px-1">写文件</span>
                ) : null}
                <span className="text-[10px] text-zinc-600">{toolSpec(String(node.data?.tool ?? ""))?.description ?? ""}</span>
              </div>
              <div>
                <div className="text-[10px] text-zinc-500 uppercase tracking-wide">Tool Input (JSON，可编辑)</div>
                <textarea
                  key={node.id}
                  className="mag-input mt-0.5 min-h-16 w-full resize-y px-2 py-1 font-mono text-xs"
                  rows={4}
                  defaultValue={JSON.stringify(node.data?.toolInput ?? {}, null, 2)}
                  onBlur={(e) => {
                    try {
                      const parsed = JSON.parse(e.target.value);
                      useGraphStore.getState().patchNodeData(node.id, { toolInput: parsed });
                    } catch {
                      /* 无效 JSON：保留输入不提交 */
                    }
                  }}
                />
              </div>
              <div className="flex flex-wrap gap-2 items-center">
                <button
                  className="mag-button mag-button-primary"
                  onClick={() => replayTools(node.parentId ?? node.id, [node.id])}
                  disabled={runningId !== null || !projectDir || !node.parentId}
                  title={!projectDir ? "请先在工具栏点 📁 选择工程目录" : !node.parentId ? "该 tool 节点不在某个执行器内部，无法单步重放" : "仅重跑这一步（不过 LLM）"}
                >
                  ▶ Replay this step
                </button>
                <span className="text-[10px] text-zinc-600">编辑后失焦保存，再点重放按新参数执行</span>
              </div>
              {node.data?.lastOutput !== undefined ? (
                <div>
                  <div className="text-[10px] text-zinc-500 uppercase tracking-wide">Last Output</div>
                  <pre className="mag-input mt-0.5 max-h-40 w-full overflow-x-auto whitespace-pre-wrap px-2 py-1 text-[11px] text-zinc-400">
                    {typeof node.data.lastOutput === "string"
                      ? node.data.lastOutput
                      : JSON.stringify(node.data.lastOutput, null, 2)}
                  </pre>
                </div>
              ) : null}
            </div>
          ) : null}

          {isTaskNode ? (
            <div className="col-span-12 min-w-0 border-t border-zinc-800/60 pt-2 text-[10px] text-zinc-600">
              Task is a normal AI node. Use Explain to summarize, inspect, or produce a manual checkpoint.
            </div>
          ) : null}

          {isTestNode ? (
            <div className="col-span-12 min-w-0 border-t border-zinc-800/60 pt-2 space-y-2">
              <div className="flex flex-wrap items-end gap-3">
                <label className="min-w-64 flex-1">
                  <span className="text-[10px] text-zinc-500 uppercase tracking-wide">Test Command</span>
                  <input
                    className="mag-input mt-0.5 w-full px-2 py-1 font-mono text-xs"
                    value={String(node.data?.testCommand ?? "uv run pytest")}
                    onChange={(e) => useGraphStore.getState().patchNodeData(node.id, { testCommand: e.target.value })}
                  />
                </label>
              </div>
              <div className="text-[10px] text-zinc-600">
                Test nodes run a whitelisted command without LLM and produce a test report for downstream nodes.
              </div>
            </div>
          ) : null}

          {isCodeNode ? (
            <div className="col-span-12 min-w-0 border-t border-zinc-800/60 pt-2 space-y-2">
              <div className="flex flex-wrap items-end gap-3">
                <label className="min-w-56">
                  <span className="text-[10px] text-zinc-500 uppercase tracking-wide">Execution Engine</span>
                  <select
                    className="mag-input mt-0.5 w-full px-2 py-1 text-xs"
                    value={executionEngine}
                    onChange={(e) => useGraphStore.getState().patchNodeData(node.id, { executionEngine: e.target.value as CodeExecutionEngine })}
                    disabled={runningId !== null}
                  >
                    <option value="native-tools">Native Tools</option>
                    <option value="claude-code">Claude Code</option>
                  </select>
                </label>
                <span className="pb-1 text-[10px] text-zinc-600">
                  {executionEngine === "claude-code"
                    ? "Calls local Claude Code CLI directly; file scope is checked after the run."
                    : "Uses MAG controlled tools with enforced file scope."}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-zinc-500 uppercase tracking-wide">Advanced Automation</span>
                <button
                  className="mag-button h-6 px-2 text-[11px]"
                  onClick={saveAsSkill}
                  disabled={runningId !== null}
                  title="把该执行器内部的 tool 子图存成可复用、可传参的技能"
                >
                  Save Macro (Experimental)
                </button>
              </div>
              {skills.length === 0 ? (
                <div className="text-[10px] text-zinc-600 italic">No saved macros yet. This records low-level Execution tool steps; workflow templates will replace this path later.</div>
              ) : (
                <div className="space-y-1.5">
                  {skills.map((skill) => (
                    <form
                      key={skill.id}
                      className="mag-list-item space-y-1 px-2 py-1.5"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const fd = new FormData(e.currentTarget);
                        const paramValues: Record<string, unknown> = {};
                        for (const p of skill.params) paramValues[p.stepId] = fd.get(p.stepId);
                        runSkill(skill.id, paramValues);
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-zinc-200 truncate">{skill.name}</span>
                        <span className="text-[10px] text-zinc-600">{skill.steps.length} 步 / {skill.params.length} 参数</span>
                        <button type="submit" className="mag-button mag-button-primary ml-auto h-6 px-2 text-[11px]" disabled={runningId !== null || !projectDir}>▶ Run</button>
                        <button
                          type="button"
                          className="mag-button h-6 px-2 text-[11px] hover:border-red-500 hover:text-red-400"
                          onClick={() => useSkillStore.getState().removeSkill(skill.id)}
                        >🗑</button>
                      </div>
                      {skill.params.map((p) => (
                        <div key={p.stepId} className="flex items-center gap-2">
                          <span className="text-[10px] text-zinc-500 w-24 truncate" title={p.name}>{p.name}</span>
                          <input
                            name={p.stepId}
                            defaultValue={String(p.default ?? "")}
                            className="mag-input flex-1 px-1.5 py-0.5 font-mono text-[11px]"
                          />
                        </div>
                      ))}
                    </form>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  if (view === "input") {
    return (
      <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0 h-full text-sm">
        <div className="grid grid-cols-4 gap-2">
          <InputStat label="Context" value={node.contextMode} tone={node.contextMode === "inherit" ? "ok" : "warn"} />
          <InputStat label="Resolved" value={String(resolvedInputs.filter((item) => item.status === "resolved").length)} />
          <InputStat label="Project Dir" value={projectDir ? "set" : "none"} tone={projectDir ? "ok" : "muted"} />
          <InputStat label="Memory" value={memoryRef || "none"} tone={memoryRef ? "ok" : "muted"} />
        </div>

        {node.contextMode !== "inherit" ? (
          <div className="rounded border border-amber-800/60 bg-amber-950/20 px-3 py-2 text-xs text-amber-200">
            This node is set to <span className="font-mono">{node.contextMode}</span>, so upstream inputs are not injected when it runs.
          </div>
        ) : null}

        <section className="rounded border border-zinc-800 bg-canvas/40">
          <div className="border-b border-zinc-800 px-3 py-1.5 text-[10px] uppercase tracking-wide text-zinc-500">
            Node Prompt
          </div>
          <div className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-1 p-3 text-xs">
            <span className="text-zinc-600">Title</span>
            <span className="text-zinc-300">{node.title}</span>
            <span className="text-zinc-600">Type</span>
            <span className="text-zinc-300">{nodeTypeLabel(node.type)}</span>
            <span className="text-zinc-600">Purpose</span>
            <span className="whitespace-pre-wrap text-zinc-300">{purpose || "(empty)"}</span>
            <span className="text-zinc-600">System Prompt</span>
            <span className="whitespace-pre-wrap text-zinc-400">{systemPrompt}</span>
          </div>
        </section>

        <section className="rounded border border-zinc-800 bg-canvas/40">
          <div className="flex items-center border-b border-zinc-800 px-3 py-1.5">
            <span className="text-[10px] uppercase tracking-wide text-zinc-500">Resolved Direct Inputs</span>
            <span className="ml-auto text-[10px] text-zinc-600">max 1200 chars per input block</span>
          </div>
          {resolvedInputs.length > 0 ? (
            <div className="divide-y divide-zinc-900/80">
              {resolvedInputs.map((item, index) => (
                <ResolvedInputRow key={`${item.sourceNodeId}:${item.targetNodeId}:${item.sourceHandle ?? ""}:${index}`} item={item} />
              ))}
            </div>
          ) : (
            <div className="px-3 py-6 text-center text-xs text-zinc-600">
              No direct input links for this node.
            </div>
          )}
        </section>

        <section className="rounded border border-zinc-800 bg-canvas/40">
          <div className="border-b border-zinc-800 px-3 py-1.5 text-[10px] uppercase tracking-wide text-zinc-500">
            Runtime Environment
          </div>
          <div className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-1 p-3 text-xs">
            <span className="text-zinc-600">Project Path</span>
            <span className="font-mono text-zinc-400">{projectPath || "(none)"}</span>
            <span className="text-zinc-600">Project Dir</span>
            <span className="font-mono text-zinc-400">{projectDir || "(none)"}</span>
            <span className="text-zinc-600">File Scope</span>
            <span className="font-mono text-zinc-400">
              allow {(node.fileScope?.allow ?? []).length} / deny {(node.fileScope?.deny ?? []).length}
            </span>
          </div>
        </section>
      </div>
    );
  }

  if (view === "output") {
    return (
      <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0 h-full text-sm">
        <section className="rounded border border-zinc-800 bg-canvas/40">
          <div className="flex items-center border-b border-zinc-800 px-3 py-1.5">
            <span className="text-[10px] uppercase tracking-wide text-zinc-500">Output Contract</span>
            <span className="ml-auto text-[10px] text-zinc-600">what downstream ports can bind to</span>
          </div>
          <div className="grid grid-cols-5 gap-2 p-3">
            <OutputInventoryItem label="output" value={`${output.length} chars`} active={output.trim().length > 0} />
            <OutputInventoryItem label="codeOutput" value={`${codeOutput.length} chars`} active={codeOutput.trim().length > 0} />
            <OutputInventoryItem label="diff" value={`${codeDiff?.diff?.length ?? 0} chars`} active={Boolean(codeDiff?.diff?.trim())} />
            <OutputInventoryItem label="files" value={`${generatedFiles.length} files`} active={generatedFiles.length > 0} />
            <OutputInventoryItem label="confirm" value={needsConfirmation ? "yes" : "no"} active={needsConfirmation} />
          </div>

          <div className="border-t border-zinc-900/80">
            <div className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-zinc-600">
              Declared Outputs
            </div>
            {resolvedOutputs.length > 0 ? (
              <div className="divide-y divide-zinc-900/80">
                {resolvedOutputs.map((item) => (
                  <ResolvedOutputRow key={item.handle} item={item} />
                ))}
              </div>
            ) : (
              <div className="px-3 pb-3 text-xs text-zinc-600">
                No output ports declared.
              </div>
            )}
          </div>

          {jsonFields.length > 0 || markdownSections.length > 0 ? (
            <div className="grid grid-cols-2 gap-3 border-t border-zinc-900/80 p-3 text-xs">
              <OutputFieldList title="JSON Fields" items={jsonFields} />
              <OutputFieldList title="Markdown Sections" items={markdownSections} />
            </div>
          ) : null}
        </section>

        {/* Execution output */}
        {codeOutput ? (
          <div>
            <div className="text-xs text-zinc-500 uppercase mb-1 flex items-center gap-2">
              <span>Execution Output</span>
              {isRunning && <span className="text-emerald-400 animate-pulse">generating…</span>}
              <button
                className="ml-auto rounded border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-400 hover:border-accent hover:text-accent"
                onClick={() => openOutputPanel(node.id, "code")}
              >
                Open Panel
              </button>
            </div>
            {codeError ? (
              <pre className="bg-red-950/40 border border-red-800/50 text-red-300 text-xs p-2 rounded whitespace-pre-wrap">
{codeError}
              </pre>
            ) : (
              <div className="bg-canvas p-2 rounded max-h-96 overflow-y-auto">
                <MarkdownPreview value={codeOutput} compact />
              </div>
            )}
          </div>
        ) : null}

        {/* Generated files */}
        {generatedFiles.length > 0 ? (
          <div>
            <div className="text-xs text-zinc-500 uppercase mb-1">Files</div>
            <div className="bg-canvas p-2 rounded text-[11px] font-mono space-y-0.5">
              {generatedFiles.map((f) => (
                <div key={f} className="text-green-400">{f}</div>
              ))}
            </div>
          </div>
        ) : null}

        {codeDiff?.diff ? (
          <details className="text-xs">
            <summary className="text-zinc-500 cursor-pointer select-none">
              Execution Diff{codeDiff.truncated ? " (truncated)" : ""}
            </summary>
            <pre className="mt-2 bg-canvas p-2 rounded whitespace-pre-wrap font-mono leading-relaxed max-h-96 overflow-y-auto text-[11px]">
{codeDiff.diff}
            </pre>
            {codeDiff.warnings && codeDiff.warnings.length > 0 ? (
              <div className="mt-1 text-[11px] text-amber-400">
                {codeDiff.warnings.join(" ")}
              </div>
            ) : null}
          </details>
        ) : null}

        {toolTrace.length > 0 ? (
          <details className="text-xs" open={isRunning}>
            <summary className="text-zinc-500 cursor-pointer select-none">
              Tool Trace
            </summary>
            <div className="mt-1 text-[10px] text-zinc-600">
              运行后自动在执行器内部生成可编辑/可重放的工具节点，进入查看。
            </div>
            <div className="mt-2 space-y-1">
              {toolTrace.map((trace) => (
                <div key={trace.id} className="rounded bg-canvas px-2 py-1 text-[11px]">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-zinc-500">#{trace.step}</span>
                    <span className="font-mono text-zinc-200">{trace.tool}</span>
                    <button
                      className="ml-auto rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-400 hover:border-accent hover:text-accent"
                      onClick={() => promoteTrace(trace)}
                    >
                      Promote
                    </button>
                    <span
                      className={
                        trace.status === "error"
                          ? "text-red-300"
                          : trace.status === "running"
                            ? "text-accent"
                            : "text-emerald-300"
                      }
                    >
                      {trace.status}
                    </span>
                  </div>
                  {trace.outputSummary ? (
                    <div className="mt-0.5 text-zinc-500 line-clamp-2">{trace.outputSummary}</div>
                  ) : null}
                  {trace.error ? (
                    <div className="mt-0.5 text-red-300 line-clamp-2">{trace.error}</div>
                  ) : null}
                  {trace.affectedFiles && trace.affectedFiles.length > 0 ? (
                    <div className="mt-0.5 font-mono text-emerald-400">
                      {trace.affectedFiles.join(", ")}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </details>
        ) : null}

        {needsConfirmation ? (
          <div className="rounded border border-amber-700/60 bg-amber-950/20 p-3">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-xs font-semibold uppercase text-amber-300">
                Needs Confirmation
              </span>
              <button
                className="ml-auto rounded border border-amber-700/70 px-2 py-0.5 text-[11px] text-amber-200 hover:bg-amber-900/30 disabled:opacity-50"
                onClick={continueWithConfirmation}
                disabled={runningId !== null}
              >
                Continue
              </button>
            </div>
            {confirmation.title ? (
              <div className="mb-1 text-sm text-zinc-100">{confirmation.title}</div>
            ) : null}
            {confirmation.note ? (
              <div className="mb-2 text-xs leading-relaxed text-zinc-400">{confirmation.note}</div>
            ) : null}
            <div className="space-y-2">
              {confirmation.questions.map((question) => (
                <label key={question.id} className="block">
                  <span className="block text-xs text-zinc-300">{question.label}</span>
                  {question.description ? (
                    <span className="block pb-1 text-[11px] leading-snug text-zinc-500">
                      {question.description}
                    </span>
                  ) : null}
                  {question.options && question.options.length > 0 ? (
                    <select
                      className="w-full rounded border border-zinc-700 bg-canvas px-2 py-1 text-xs outline-none focus:border-amber-500"
                      value={confirmationAnswers[question.id] ?? ""}
                      onChange={(e) => updateConfirmationAnswer(question.id, e.target.value)}
                    >
                      <option value="">Select...</option>
                      {question.options.map((option) => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
                  ) : (
                    <textarea
                      className="w-full min-h-16 resize-y rounded border border-zinc-700 bg-canvas px-2 py-1 text-xs outline-none focus:border-amber-500"
                      value={confirmationAnswers[question.id] ?? ""}
                      placeholder={question.placeholder ?? "输入确认内容..."}
                      onChange={(e) => updateConfirmationAnswer(question.id, e.target.value)}
                    />
                  )}
                </label>
              ))}
            </div>
          </div>
        ) : null}

        {/* Text output (Explain mode) */}
        <div>
          <div className="text-xs text-zinc-500 uppercase mb-1 flex items-center gap-2">
            <span>Output</span>
            {isRunning && <span className="text-accent animate-pulse">streaming…</span>}
            {output ? (
              <button
                className="ml-auto rounded border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-400 hover:border-accent hover:text-accent"
                onClick={() => openOutputPanel(node.id, "explain")}
              >
                Open Panel
              </button>
            ) : null}
          </div>
          {error ? (
            <pre className="bg-red-950/40 border border-red-800/50 text-red-300 text-xs p-2 rounded whitespace-pre-wrap">
{error}
            </pre>
          ) : output ? (
            <pre className="bg-canvas text-xs p-2 rounded whitespace-pre-wrap font-sans leading-relaxed max-h-64 overflow-y-auto">
{output}
            </pre>
          ) : (
            !codeOutput && (
              <div className="text-zinc-600 text-xs italic">
                {isCodeNode
                  ? "点 ▶ Explain 文本展开 或 ⚡ Execution 运行执行器"
                  : isCodeAnalysisNode
                    ? "选择 Project Dir 后点 ◇ Analyze Code 让 Claude Code 只读分析代码，完成后用 ⬡ Module Graph 生成模块图"
                  : isGraphNode
                    ? "Design 节点可先用 Explain 生成内容，再用 Export Document 导出为 Markdown；Subgraph 可用 Generate Nodes 展开内部结构。"
                    : "点 ▶ Explain 文本展开"}
              </div>
            )
          )}
        </div>
      </div>
    );
  }

  if (view === "scope") {
    return (
      <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0 h-full text-sm">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-[10px] text-zinc-500 uppercase tracking-wide">Allow (glob, comma-separated)</div>
            <input
              className="w-full bg-canvas border border-zinc-700 rounded px-2 py-1 mt-0.5 text-xs outline-none focus:border-accent font-mono"
              placeholder="src/**, lib/**"
              value={(node.fileScope?.allow ?? []).join(", ")}
              onChange={(e) => {
                const val = e.target.value;
                const allow = val ? val.split(",").map((s) => s.trim()).filter(Boolean) : [];
                updateNode(node.id, { fileScope: { ...node.fileScope, allow } });
              }}
            />
          </div>
          <div>
            <div className="text-[10px] text-zinc-500 uppercase tracking-wide">Deny (glob)</div>
            <input
              className="w-full bg-canvas border border-zinc-700 rounded px-2 py-1 mt-0.5 text-xs outline-none focus:border-accent font-mono"
              placeholder="vendor/**, *.secret"
              value={(node.fileScope?.deny ?? []).join(", ")}
              onChange={(e) => {
                const val = e.target.value;
                const deny = val ? val.split(",").map((s) => s.trim()).filter(Boolean) : [];
                updateNode(node.id, { fileScope: { ...node.fileScope, deny } });
              }}
            />
          </div>
        </div>
        <details className="text-xs">
          <summary className="text-zinc-500 cursor-pointer select-none">Raw Data</summary>
          <pre className="mt-2 bg-canvas p-2 rounded overflow-auto text-[11px]">
{JSON.stringify({ data: node.data }, null, 2)}
          </pre>
        </details>

        {node.runHistory && node.runHistory.length > 0 ? (
          <details className="text-xs">
            <summary className="text-zinc-500 cursor-pointer select-none">
              Run History
            </summary>
            <div className="mt-2 space-y-1">
              {node.runHistory.slice(-5).map((run) => (
                <div key={run.id} className="rounded bg-canvas px-2 py-1 text-[11px] text-zinc-400">
                  <span className="text-zinc-300">{run.status}</span>
                  <span className="ml-2">{run.provider ?? "provider"}</span>
                  <span className="ml-2">{new Date(run.startedAt).toLocaleTimeString()}</span>
                  {run.diff ? <span className="ml-2 text-emerald-400">diff</span> : null}
                </div>
              ))}
            </div>
          </details>
        ) : null}
      </div>
    );
  }

  return null;
}

function uniquePortId(ports: DataPort[], base: string): string {
  let candidate = base;
  let suffix = 2;
  const existing = new Set(ports.map((port) => port.id));
  while (existing.has(candidate)) {
    candidate = `${base}_${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function PortEditor({
  title,
  direction,
  ports,
  onChange,
}: {
  title: string;
  direction: "inputs" | "outputs";
  ports: DataPort[];
  onChange: (ports: DataPort[], changed?: { oldId: string; newId?: string }) => void;
}) {
  const fallbackPrefix = direction === "inputs" ? "input" : "output";
  const addPort = () => {
    const id = uniquePortId(ports, `${fallbackPrefix}_${ports.length + 1}`);
    onChange([...ports, { id, name: direction === "inputs" ? "Input" : "Output", type: "unknown" }]);
  };

  return (
    <div className="rounded border border-zinc-800 bg-canvas/40 p-2">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-[10px] text-zinc-400 uppercase tracking-wide">{title}</span>
        <button
          type="button"
          className="ml-auto rounded border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-300 hover:border-accent hover:text-accent"
          onClick={addPort}
        >
          + Port
        </button>
      </div>
      {ports.length === 0 ? (
        <div className="rounded border border-dashed border-zinc-800 px-2 py-3 text-center text-[11px] text-zinc-600">
          No {title.toLowerCase()}
        </div>
      ) : (
        <div className="space-y-2">
          {ports.map((port, index) => (
            <div key={index} className="rounded border border-zinc-800/80 bg-black/10 p-2">
              <div className="grid grid-cols-1 gap-2">
                <label className="min-w-0">
                  <span className="text-[10px] uppercase tracking-wide text-zinc-600">Name</span>
                  <input
                    className="mt-0.5 w-full min-w-0 rounded border border-zinc-700 bg-canvas px-1.5 py-1 text-[11px] outline-none focus:border-accent"
                    value={port.name}
                    placeholder="Name"
                    title="Visible port label"
                    onChange={(e) => {
                      const name = e.target.value;
                      onChange(ports.map((item, i) => i === index ? { ...item, name } : item));
                    }}
                  />
                </label>
                <div className="grid grid-cols-[1fr_112px] gap-2">
                  <label className="min-w-0">
                    <span className="text-[10px] uppercase tracking-wide text-zinc-600">Handle</span>
                    <input
                      className="mt-0.5 w-full min-w-0 rounded border border-zinc-700 bg-canvas px-1.5 py-1 font-mono text-[11px] outline-none focus:border-accent"
                      value={port.id}
                      placeholder="id"
                      title="Stable handle id used by links"
                      onChange={(e) => {
                        const oldId = port.id;
                        const nextId = uniquePortId(
                          ports.filter((_, i) => i !== index),
                          portIdFromName(e.target.value, `${fallbackPrefix}_${index + 1}`),
                        );
                        onChange(
                          ports.map((item, i) => i === index ? { ...item, id: nextId } : item),
                          { oldId, newId: nextId },
                        );
                      }}
                    />
                  </label>
                  <label>
                    <span className="text-[10px] uppercase tracking-wide text-zinc-600">Type</span>
                    <select
                      className="mt-0.5 w-full rounded border border-zinc-700 bg-canvas px-1.5 py-1 text-[11px] outline-none focus:border-accent"
                      value={port.type}
                      onChange={(e) => {
                        const type = isDataPortType(e.target.value) ? e.target.value : "unknown";
                        onChange(ports.map((item, i) => i === index ? { ...item, type } : item));
                      }}
                    >
                      {DATA_PORT_TYPES.map((type) => (
                        <option key={type} value={type}>{type}</option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  className="rounded border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-400 hover:border-red-500 hover:text-red-300"
                  title="Delete port and its connected links"
                  onClick={() => {
                    onChange(ports.filter((_, i) => i !== index), { oldId: port.id });
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function InputStat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "ok" | "warn" | "muted";
}) {
  const valueClass =
    tone === "ok"
      ? "text-emerald-300"
      : tone === "warn"
        ? "text-amber-300"
        : tone === "muted"
          ? "text-zinc-600"
          : "text-zinc-300";
  return (
    <div className="rounded border border-zinc-800 bg-canvas/40 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-zinc-600">{label}</div>
      <div className={`mt-0.5 truncate font-mono text-xs ${valueClass}`} title={value}>{value}</div>
    </div>
  );
}

function OutputInventoryItem({
  label,
  value,
  active,
}: {
  label: string;
  value: string;
  active: boolean;
}) {
  return (
    <div className="rounded border border-zinc-800 bg-black/10 px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-zinc-600">{label}</div>
      <div className={`mt-0.5 truncate font-mono text-xs ${active ? "text-emerald-300" : "text-zinc-600"}`}>
        {value}
      </div>
    </div>
  );
}

function OutputFieldList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 text-[10px] uppercase tracking-wide text-zinc-600">{title}</div>
      {items.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {items.slice(0, 16).map((item) => (
            <span key={item} className="max-w-full truncate rounded border border-zinc-800 bg-black/10 px-1.5 py-0.5 font-mono text-[11px] text-zinc-400" title={item}>
              {item}
            </span>
          ))}
          {items.length > 16 ? (
            <span className="text-[11px] text-zinc-600">+{items.length - 16}</span>
          ) : null}
        </div>
      ) : (
        <div className="text-[11px] text-zinc-600">none</div>
      )}
    </div>
  );
}

function ResolvedOutputRow({ item }: { item: ResolvedOutput }) {
  const statusClass = item.status === "resolved" ? "text-emerald-300" : "text-zinc-500";
  return (
    <details className="group px-3 py-2 text-xs" open={item.status === "resolved"}>
      <summary className="flex cursor-pointer list-none items-center gap-2">
        <span className={statusClass}>{item.status}</span>
        <span className="font-mono text-zinc-300">{item.name}</span>
        <span className="font-mono text-zinc-600">({item.handle})</span>
        <span className="rounded border border-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">{item.type}</span>
        <span className="ml-auto text-[10px] text-zinc-600">{item.sourceKind}, {item.rawLength} chars</span>
      </summary>
      <div className="mt-2 grid grid-cols-[120px_1fr] gap-x-3 gap-y-1">
        <span className="text-zinc-600">Binding Handle</span>
        <span className="font-mono text-zinc-400">{item.handle}</span>
        <span className="text-zinc-600">Resolution</span>
        <span className={statusClass}>
          {item.status === "resolved"
            ? `Downstream sourceHandle=${item.handle} resolves from ${item.sourceKind}.`
            : "No output currently resolves for this port."}
        </span>
      </div>
      {item.content ? (
        <pre className="mt-2 max-h-40 overflow-auto rounded bg-black/20 p-2 whitespace-pre-wrap text-[11px] leading-relaxed text-zinc-300">
{item.content.slice(0, 1200)}
{item.content.length > 1200 ? "\n..." : ""}
        </pre>
      ) : null}
    </details>
  );
}

function ResolvedInputRow({ item }: { item: ResolvedInput }) {
  const statusClass =
    item.status === "resolved"
      ? "text-emerald-300"
      : item.status === "disabled"
        ? "text-amber-300"
        : "text-zinc-500";
  const source = `${item.sourceTitle}.${item.sourcePortName ?? item.sourceHandle ?? "output"}`;
  const target = `${item.targetTitle}.${item.targetPortName ?? item.targetHandle ?? "input"}`;
  return (
    <details className="group px-3 py-2 text-xs" open={item.status !== "disabled"}>
      <summary className="flex cursor-pointer list-none items-center gap-2">
        <span className={statusClass}>{item.status}</span>
        <span className="font-mono text-zinc-500">{source}</span>
        <span className="text-zinc-700">-&gt;</span>
        <span className="font-mono text-zinc-300">{target}</span>
        <span className="ml-auto text-[10px] text-zinc-600">
          {item.sourceKind}
          {item.truncated ? `, ${item.rawLength} -> ${item.passedLength}` : `, ${item.passedLength}`}
        </span>
      </summary>
      <div className="mt-2 grid grid-cols-[120px_1fr] gap-x-3 gap-y-1">
        <span className="text-zinc-600">Binding Key</span>
        <span className="font-mono text-zinc-400">{item.key}</span>
        <span className="text-zinc-600">Source Node</span>
        <span className="text-zinc-400">{item.sourceTitle} <span className="font-mono text-zinc-600">({item.sourceNodeId})</span></span>
        <span className="text-zinc-600">Resolution</span>
        <span className={statusClass}>
          {item.status === "disabled"
            ? "Not injected because contextMode is not inherit."
            : item.status === "empty"
              ? "No output or purpose was available."
              : `Resolved from ${item.sourceKind}${item.truncated ? "; truncated for prompt context." : "."}`}
        </span>
      </div>
      {item.content ? (
        <pre className="mt-2 max-h-48 overflow-auto rounded bg-black/20 p-2 whitespace-pre-wrap text-[11px] leading-relaxed text-zinc-300">
{item.content}
        </pre>
      ) : null}
    </details>
  );
}

function getConfirmationRequest(value: unknown): ConfirmationRequest | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<ConfirmationRequest>;
  if (!Array.isArray(raw.questions) || raw.questions.length === 0) return null;
  return raw as ConfirmationRequest;
}

function getConfirmationAnswers(value: unknown): ConfirmationAnswers {
  if (!value || typeof value !== "object") return {};
  const raw = value as Record<string, unknown>;
  const answers: ConfirmationAnswers = {};
  for (const [key, answer] of Object.entries(raw)) {
    if (typeof answer === "string") answers[key] = answer;
  }
  return answers;
}

function contextHint(mode: "inherit" | "explicit" | "isolated"): string {
  if (mode === "inherit") return "继承上游输出，并读取 Memory。";
  if (mode === "isolated") return "隔离执行，不继承上游，不读写 Memory。";
  return "仅使用当前节点字段和本次输入。";
}
