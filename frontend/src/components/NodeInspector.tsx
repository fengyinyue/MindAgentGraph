import { useGraphStore } from "@/store/graphStore";
import { useRunNode } from "@/hooks/useRunNode";
import { NODE_TYPES, type NodeType } from "@shared/types";

export default function NodeInspector() {
  const selectedId = useGraphStore((s) => s.selectedNodeId);
  const node = useGraphStore((s) =>
    s.nodes.find((n) => n.id === selectedId),
  );
  const { run, runCode, cancel, runningId } = useRunNode();
  const updateNode = useGraphStore((s) => s.updateNode);
  const projectDir = useGraphStore((s) => s.projectDir);

  if (!node) {
    return (
      <div className="p-4 text-zinc-500 text-sm">
        选择一个节点查看上下文 / Memory / 文件作用域。右键节点可以运行。
      </div>
    );
  }

  const isRunning = runningId === node.id;
  const output = (node.data?.output as string | undefined) ?? "";
  const codeOutput = (node.data?.codeOutput as string | undefined) ?? "";
  const error = (node.data?.error as string | undefined) ?? "";
  const codeError = (node.data?.codeError as string | undefined) ?? "";
  const purpose = (node.data?.purpose as string | undefined) ?? "";
  const generatedFiles = (node.data?.generatedFiles as string[] | undefined) ?? [];
  const systemPrompt = node.systemPrompt ?? "";
  const memoryRef = node.memoryRef ?? "";

  return (
    <div className="flex flex-col h-full text-sm">
      <div className="p-4 space-y-3 border-b border-zinc-800">
        <div>
          <div className="text-xs text-zinc-500 uppercase">Title</div>
          <input
            className="w-full bg-canvas border border-zinc-700 rounded px-2 py-1 mt-0.5 text-sm outline-none focus:border-accent"
            value={node.title}
            onChange={(e) => updateNode(node.id, { title: e.target.value })}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-xs text-zinc-500 uppercase">Type</div>
            <select
              className="w-full bg-canvas border border-zinc-700 rounded px-1.5 py-1 mt-0.5 text-sm outline-none focus:border-accent"
              value={node.type}
              onChange={(e) => updateNode(node.id, { type: e.target.value as NodeType })}
            >
              {NODE_TYPES.map((nt) => (
                <option key={nt} value={nt}>{nt}</option>
              ))}
            </select>
          </div>
          <div>
            <div className="text-xs text-zinc-500 uppercase">Context</div>
            <select
              className="w-full bg-canvas border border-zinc-700 rounded px-1.5 py-1 mt-0.5 text-sm outline-none focus:border-accent"
              value={node.contextMode}
              onChange={(e) => updateNode(node.id, { contextMode: e.target.value as "inherit" | "explicit" | "isolated" })}
            >
              <option value="inherit">inherit</option>
              <option value="explicit">explicit</option>
              <option value="isolated">isolated</option>
            </select>
          </div>
        </div>
        <div>
          <div className="text-xs text-zinc-500 uppercase">Purpose / Node Prompt</div>
          <textarea
            className="w-full bg-canvas border border-zinc-700 rounded px-2 py-1 mt-0.5 text-xs outline-none focus:border-accent resize-y min-h-16"
            value={purpose}
            placeholder="这个节点自己的任务说明"
            onChange={(e) => useGraphStore.getState().patchNodeData(node.id, { purpose: e.target.value })}
          />
        </div>
        <div>
          <div className="text-xs text-zinc-500 uppercase">System Prompt</div>
          <textarea
            className="w-full bg-canvas border border-zinc-700 rounded px-2 py-1 mt-0.5 text-xs outline-none focus:border-accent resize-y min-h-16"
            value={systemPrompt}
            placeholder="留空则使用全局默认节点助手 prompt"
            onChange={(e) => updateNode(node.id, { systemPrompt: e.target.value })}
          />
        </div>
        <div>
          <div className="text-xs text-zinc-500 uppercase">Memory Ref</div>
          <input
            className="w-full bg-canvas border border-zinc-700 rounded px-2 py-1 mt-0.5 text-xs outline-none focus:border-accent font-mono"
            value={memoryRef}
            placeholder="architecture.md"
            onChange={(e) => updateNode(node.id, { memoryRef: e.target.value || undefined })}
          />
        </div>
        <div className="flex gap-2 pt-1">
          {isRunning ? (
            <button className="px-3 py-1.5 bg-red-700 rounded text-xs" onClick={cancel}>
              ■ Cancel
            </button>
          ) : (
            <>
              <button
                className="px-3 py-1.5 bg-accent rounded text-xs disabled:opacity-50"
                onClick={() => run(node.id)}
                disabled={runningId !== null}
              >
                ▶ Explain
              </button>
              <button
                className="px-3 py-1.5 bg-emerald-700 rounded text-xs disabled:opacity-50"
                onClick={() => runCode(node.id)}
                disabled={runningId !== null || !projectDir}
                title={!projectDir ? "请先在工具栏点 📁 选择工程目录" : "Claude Code 生成代码"}
              >
                ⚡ Code
              </button>
            </>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
        {/* Code output */}
        {codeOutput ? (
          <div>
            <div className="text-xs text-zinc-500 uppercase mb-1 flex items-center gap-2">
              <span>Code Output</span>
              {isRunning && <span className="text-emerald-400 animate-pulse">generating…</span>}
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

        {/* Text output (Explain mode) */}
        <div>
          <div className="text-xs text-zinc-500 uppercase mb-1 flex items-center gap-2">
            <span>Output</span>
            {isRunning && <span className="text-accent animate-pulse">streaming…</span>}
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
                点 ▶ Explain 文本展开 或 ⚡ Code 生成代码
              </div>
            )
          )}
        </div>

        <details className="text-xs" open>
          <summary className="text-zinc-500 cursor-pointer select-none">
            File Scope / Data
          </summary>
          <div className="mt-2 space-y-2">
            <div>
              <div className="text-zinc-500 mb-1">Allow (glob, comma-separated)</div>
              <input
                className="w-full bg-canvas border border-zinc-700 rounded px-2 py-1 text-xs outline-none focus:border-accent font-mono"
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
              <div className="text-zinc-500 mb-1">Deny (glob)</div>
              <input
                className="w-full bg-canvas border border-zinc-700 rounded px-2 py-1 text-xs outline-none focus:border-accent font-mono"
                placeholder="vendor/**, *.secret"
                value={(node.fileScope?.deny ?? []).join(", ")}
                onChange={(e) => {
                  const val = e.target.value;
                  const deny = val ? val.split(",").map((s) => s.trim()).filter(Boolean) : [];
                  updateNode(node.id, { fileScope: { ...node.fileScope, deny } });
                }}
              />
            </div>
            <pre className="bg-canvas p-2 rounded overflow-auto text-[11px]">
{JSON.stringify({ data: node.data }, null, 2)}
            </pre>
          </div>
        </details>
      </div>
    </div>
  );
}
