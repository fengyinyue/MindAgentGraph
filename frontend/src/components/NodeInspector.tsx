import { useGraphStore } from "@/store/graphStore";
import { useRunNode } from "@/hooks/useRunNode";
import { useOutputPanelStore } from "@/store/outputPanelStore";
import {
  buildConfirmationPrompt,
  type ConfirmationAnswers,
  type ConfirmationRequest,
} from "@/utils/confirmation";
import { allowedNodeTypes, type NodeBase, type NodeType, type ToolTraceItem } from "@shared/types";
import { toolSpec } from "@/toolRegistry";
import { tracePurpose } from "@/utils/traceNodes";

function nodeTypeLabel(type: NodeType): string {
  if (type === "planning") return "Planning";
  if (type === "subgraph") return "Subgraph";
  if (type === "analysis") return "Analysis";
  return type;
}

export type InspectorView = "props" | "output" | "scope";

export default function NodeInspector({ view = "props" }: { view?: InspectorView } = {}) {
  const selectedId = useGraphStore((s) => s.selectedNodeId);
  const node = useGraphStore((s) =>
    s.nodes.find((n) => n.id === selectedId),
  );
  // Layer of the selected node = type of its container (Phase 3 type vocabulary).
  const parentType = useGraphStore((s) => {
    const self = s.nodes.find((n) => n.id === selectedId);
    if (!self?.parentId) return null;
    return s.nodes.find((n) => n.id === self.parentId)?.type ?? null;
  });
  const { run, runCode, replayTools, expandPlanNodes, expandModuleGraph, cancel, runningId } = useRunNode();
  const updateNode = useGraphStore((s) => s.updateNode);
  const projectDir = useGraphStore((s) => s.projectDir);
  const enterSubgraph = useGraphStore((s) => s.enterSubgraph);
  const openOutputPanel = useOutputPanelStore((s) => s.open);

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
  const systemPrompt = node.systemPrompt ?? "";
  const memoryRef = node.memoryRef ?? "";
  const isCodeNode = node.type === "code";
  const isToolNode = node.type === "tool";
  const isGraphNode = node.type === "planning" || node.type === "subgraph";
  const isCodeAnalysisNode = node.type === "analysis";
  const isPlanningNode = node.type === "planning";
  const canGenerateNodes = isGraphNode;
  const canGenerateModuleGraph = isCodeAnalysisNode && output.trim().length > 0;
  const confirmation = getConfirmationRequest(node.data?.confirmation);
  const confirmationAnswers = getConfirmationAnswers(node.data?.confirmationAnswers);
  const needsConfirmation = node.data?.status === "needs_confirmation" && confirmation !== null;

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
        <div className="p-3 grid grid-cols-12 gap-x-3 gap-y-2">
          <div className="col-span-4 min-w-0">
            <div className="text-[10px] text-zinc-500 uppercase tracking-wide">Title</div>
            <input
              className="w-full bg-canvas border border-zinc-700 rounded px-2 py-1 mt-0.5 text-xs outline-none focus:border-accent"
              value={node.title}
              onChange={(e) => updateNode(node.id, { title: e.target.value })}
            />
          </div>
          <div className="col-span-2 min-w-0">
            <div className="text-[10px] text-zinc-500 uppercase tracking-wide">Type</div>
            <select
              className="w-full bg-canvas border border-zinc-700 rounded px-1.5 py-1 mt-0.5 text-xs outline-none focus:border-accent"
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
              className="w-full bg-canvas border border-zinc-700 rounded px-1.5 py-1 mt-0.5 text-xs outline-none focus:border-accent"
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
              className="w-full bg-canvas border border-zinc-700 rounded px-2 py-1 mt-0.5 text-xs outline-none focus:border-accent font-mono"
              value={memoryRef}
              placeholder="architecture.md"
              onChange={(e) => updateNode(node.id, { memoryRef: e.target.value || undefined })}
            />
          </div>

          <div className="col-span-6 min-w-0">
            <div className="text-[10px] text-zinc-500 uppercase tracking-wide">Purpose / Node Prompt</div>
            <textarea
              className="w-full bg-canvas border border-zinc-700 rounded px-2 py-1 mt-0.5 text-xs outline-none focus:border-accent resize-y min-h-14"
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
            <div className="text-[10px] text-zinc-500 uppercase tracking-wide">System Prompt</div>
            <textarea
              className="w-full bg-canvas border border-zinc-700 rounded px-2 py-1 mt-0.5 text-xs outline-none focus:border-accent resize-y min-h-14"
              rows={3}
              value={systemPrompt}
              placeholder="留空则使用全局默认节点助手 prompt"
              onChange={(e) => updateNode(node.id, { systemPrompt: e.target.value })}
            />
          </div>

          <div className="col-span-12 flex flex-wrap gap-2 pt-1 border-t border-zinc-800/60">
            {isRunning ? (
              <button className="px-3 py-1 bg-red-700 rounded text-xs" onClick={cancel}>
                ■ Cancel
              </button>
            ) : (
              <>
                <button
                  className="px-3 py-1 bg-accent rounded text-xs disabled:opacity-50"
                  onClick={() => run(node.id)}
                  disabled={runningId !== null || (isCodeAnalysisNode && !projectDir)}
                  title={isCodeAnalysisNode && !projectDir ? "请先在工具栏选择 Project Dir" : undefined}
                >
                  {isCodeAnalysisNode ? "◇ Analyze Code" : "▶ Explain"}
                </button>
                {canGenerateNodes ? (
                  <button
                    className="px-3 py-1 bg-purple-700 rounded text-xs disabled:opacity-50"
                    onClick={() => expandPlanNodes(node.id, "design")}
                    disabled={runningId !== null}
                    title={isPlanningNode ? "在规划器内部生成数据流设计（drill-in）" : "生成内部数据流子节点"}
                  >
                    ✦ Generate Nodes
                  </button>
                ) : null}
                {isPlanningNode ? (
                  <button
                    className="px-3 py-1 bg-emerald-700 rounded text-xs disabled:opacity-50"
                    onClick={() => expandPlanNodes(node.id, "execute")}
                    disabled={runningId !== null}
                    title="在外层分解出执行（code）节点"
                  >
                    ▶ 执行
                  </button>
                ) : null}
                {canGenerateModuleGraph ? (
                  <button
                    className="px-3 py-1 bg-cyan-700 rounded text-xs disabled:opacity-50"
                    onClick={() => expandModuleGraph(node.id)}
                    disabled={runningId !== null}
                  >
                    ⬡ Module Graph
                  </button>
                ) : null}
                {isGraphNode ? (
                  <button
                    className="px-3 py-1 bg-teal-700 rounded text-xs disabled:opacity-50"
                    onClick={() => enterSubgraph(node.id)}
                    disabled={runningId !== null}
                  >
                    Enter
                  </button>
                ) : null}
                {isCodeNode ? (
                  <>
                    <button
                      className="px-3 py-1 bg-emerald-700 rounded text-xs disabled:opacity-50"
                      onClick={() => runCode(node.id)}
                      disabled={runningId !== null || !projectDir}
                      title={!projectDir ? "请先在工具栏点 📁 选择工程目录" : "MAG Native Code Runner"}
                    >
                      ⚡ Code
                    </button>
                    <button
                      className="px-3 py-1 bg-teal-700 rounded text-xs disabled:opacity-50"
                      onClick={() => enterSubgraph(node.id)}
                      disabled={runningId !== null}
                    >
                      Enter Code
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
                <span className="text-xs font-mono text-zinc-200">{String(node.data?.tool ?? "?")}</span>
                {toolSpec(String(node.data?.tool ?? ""))?.writes ? (
                  <span className="text-[10px] text-amber-400 border border-amber-700/60 rounded px-1">写文件</span>
                ) : null}
                <span className="text-[10px] text-zinc-600">{toolSpec(String(node.data?.tool ?? ""))?.description ?? ""}</span>
              </div>
              <div>
                <div className="text-[10px] text-zinc-500 uppercase tracking-wide">Tool Input (JSON，可编辑)</div>
                <textarea
                  key={node.id}
                  className="w-full bg-canvas border border-zinc-700 rounded px-2 py-1 mt-0.5 text-xs outline-none focus:border-accent resize-y min-h-16 font-mono"
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
                  className="px-3 py-1 bg-emerald-700 rounded text-xs disabled:opacity-50"
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
                  <pre className="w-full bg-canvas border border-zinc-800 rounded px-2 py-1 mt-0.5 text-[11px] text-zinc-400 overflow-x-auto max-h-40 whitespace-pre-wrap">
                    {typeof node.data.lastOutput === "string"
                      ? node.data.lastOutput
                      : JSON.stringify(node.data.lastOutput, null, 2)}
                  </pre>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  if (view === "output") {
    return (
      <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0 h-full text-sm">
        {/* Code output */}
        {codeOutput ? (
          <div>
            <div className="text-xs text-zinc-500 uppercase mb-1 flex items-center gap-2">
              <span>Code Output</span>
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
              <pre className="bg-canvas text-xs p-2 rounded whitespace-pre-wrap font-mono leading-relaxed max-h-96 overflow-y-auto">
{codeOutput}
              </pre>
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
              Code Diff{codeDiff.truncated ? " (truncated)" : ""}
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
                  ? "点 ▶ Explain 文本展开 或 ⚡ Code 生成代码"
                  : isCodeAnalysisNode
                    ? "选择 Project Dir 后点 ◇ Analyze Code 让 Claude Code 只读分析代码，完成后用 ⬡ Module Graph 生成模块图"
                  : isGraphNode
                    ? "填写 Purpose 后直接点 ✦ Generate Nodes 展开子节点；想先看/改规划可先点 ▶ Explain"
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
