import { useGraphStore } from "@/store/graphStore";

export default function NodeInspector() {
  const selectedId = useGraphStore((s) => s.selectedNodeId);
  const node = useGraphStore((s) =>
    s.nodes.find((n) => n.id === selectedId)
  );

  if (!node) {
    return (
      <div className="p-4 text-zinc-500 text-sm">
        选择一个节点查看上下文 / Memory / 文件作用域
      </div>
    );
  }

  return (
    <div className="p-4 space-y-3 text-sm overflow-y-auto h-full">
      <div>
        <div className="text-xs text-zinc-500 uppercase">Title</div>
        <div className="font-medium">{node.title}</div>
      </div>
      <div>
        <div className="text-xs text-zinc-500 uppercase">Type</div>
        <div>{node.type}</div>
      </div>
      <div>
        <div className="text-xs text-zinc-500 uppercase">Context Mode</div>
        <div>{node.contextMode}</div>
      </div>
      <div>
        <div className="text-xs text-zinc-500 uppercase">File Scope</div>
        <pre className="bg-canvas p-2 rounded text-xs overflow-auto">
{JSON.stringify(node.fileScope, null, 2)}
        </pre>
      </div>
      <div>
        <div className="text-xs text-zinc-500 uppercase">Data</div>
        <pre className="bg-canvas p-2 rounded text-xs overflow-auto">
{JSON.stringify(node.data, null, 2)}
        </pre>
      </div>
      {node.summary && (
        <div>
          <div className="text-xs text-zinc-500 uppercase">Summary</div>
          <div className="text-zinc-300">{node.summary}</div>
        </div>
      )}
    </div>
  );
}
