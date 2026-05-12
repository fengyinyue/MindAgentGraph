import { useGraphStore } from "@/store/graphStore";
import { useRunNode } from "@/hooks/useRunNode";

export default function NodeInspector() {
  const selectedId = useGraphStore((s) => s.selectedNodeId);
  const node = useGraphStore((s) =>
    s.nodes.find((n) => n.id === selectedId),
  );
  const { run, cancel, runningId } = useRunNode();

  if (!node) {
    return (
      <div className="p-4 text-zinc-500 text-sm">
        选择一个节点查看上下文 / Memory / 文件作用域。右键节点可以运行。
      </div>
    );
  }

  const isRunning = runningId === node.id;
  const output = (node.data?.output as string | undefined) ?? "";
  const error = node.data?.error as string | undefined;
  const purpose = (node.data?.purpose as string | undefined) ?? "";

  return (
    <div className="flex flex-col h-full text-sm">
      <div className="p-4 space-y-3 border-b border-zinc-800">
        <div>
          <div className="text-xs text-zinc-500 uppercase">Title</div>
          <div className="font-medium">{node.title}</div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-xs text-zinc-500 uppercase">Type</div>
            <div>{node.type}</div>
          </div>
          <div>
            <div className="text-xs text-zinc-500 uppercase">Context</div>
            <div>{node.contextMode}</div>
          </div>
        </div>
        {purpose && (
          <div>
            <div className="text-xs text-zinc-500 uppercase">Purpose</div>
            <div className="text-zinc-300">{purpose}</div>
          </div>
        )}
        <div className="flex gap-2 pt-1">
          {isRunning ? (
            <button
              className="px-3 py-1.5 bg-red-700 rounded text-xs"
              onClick={cancel}
            >
              ■ Cancel
            </button>
          ) : (
            <button
              className="px-3 py-1.5 bg-accent rounded text-xs disabled:opacity-50"
              onClick={() => run(node.id)}
              disabled={runningId !== null}
            >
              ▶ Run
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
        <div>
          <div className="text-xs text-zinc-500 uppercase mb-1 flex items-center gap-2">
            <span>Output</span>
            {isRunning && (
              <span className="text-accent animate-pulse">streaming…</span>
            )}
          </div>
          {error ? (
            <pre className="bg-red-950/40 border border-red-800/50 text-red-300 text-xs p-2 rounded whitespace-pre-wrap">
{error}
            </pre>
          ) : output ? (
            <pre className="bg-canvas text-xs p-2 rounded whitespace-pre-wrap font-sans leading-relaxed">
{output}
            </pre>
          ) : (
            <div className="text-zinc-600 text-xs italic">
              点 ▶ Run 或在画布上右键节点 → Run node
            </div>
          )}
        </div>

        <details className="text-xs">
          <summary className="text-zinc-500 cursor-pointer select-none">
            File Scope / Data (raw)
          </summary>
          <pre className="bg-canvas p-2 rounded mt-2 overflow-auto text-[11px]">
{JSON.stringify({ fileScope: node.fileScope, data: node.data }, null, 2)}
          </pre>
        </details>
      </div>
    </div>
  );
}
