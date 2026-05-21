import { useMemo, useState } from "react";
import { useGraphStore } from "@/store/graphStore";
import type { Edge, NodeBase, NodeType } from "@shared/types";

type Tab = "nodes" | "files" | "agents";

interface TreeItem {
  id: string;
  title: string;
  type: NodeType;
  depth: number;
  hasCycle?: boolean;
}

export function buildNodeTree(nodes: NodeBase[], links: Edge[]): TreeItem[] {
  const ids = new Set(nodes.map((n) => n.id));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const indegree = new Map(nodes.map((n) => [n.id, 0]));
  const children = new Map(nodes.map((n) => [n.id, [] as string[]]));

  for (const link of links) {
    if (!ids.has(link.source) || !ids.has(link.target)) continue;
    indegree.set(link.target, (indegree.get(link.target) ?? 0) + 1);
    children.get(link.source)?.push(link.target);
  }

  const roots = nodes.filter((n) => (indegree.get(n.id) ?? 0) === 0);
  const items: TreeItem[] = [];
  const emitted = new Set<string>();

  const visit = (id: string, depth: number, path: Set<string>) => {
    const node = byId.get(id);
    if (!node) return;
    const hasCycle = path.has(id);
    if (!emitted.has(id)) {
      items.push({ id, title: node.title || "Untitled", type: node.type, depth, hasCycle });
      emitted.add(id);
    }
    if (hasCycle) return;
    const nextPath = new Set(path);
    nextPath.add(id);
    for (const childId of children.get(id) ?? []) {
      visit(childId, depth + 1, nextPath);
    }
  };

  for (const root of roots) visit(root.id, 0, new Set());
  for (const node of nodes) {
    if (!emitted.has(node.id)) visit(node.id, 0, new Set());
  }

  return items;
}

export default function ProjectExplorer() {
  const [activeTab, setActiveTab] = useState<Tab>("nodes");
  const nodes = useGraphStore((s) => s.nodes);
  const links = useGraphStore((s) => s.links);
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
  const selectNode = useGraphStore((s) => s.selectNode);
  const tree = useMemo(() => buildNodeTree(nodes, links), [nodes, links]);
  const agentNodes = nodes.filter((n) => n.type === "agent");

  return (
    <div className="flex h-full min-h-0 flex-col text-xs">
      <div className="flex gap-1 border-b border-zinc-800 px-2 py-1">
        <TabButton label="节点" active={activeTab === "nodes"} onClick={() => setActiveTab("nodes")} />
        <TabButton label="文件" active={activeTab === "files"} onClick={() => setActiveTab("files")} />
        <TabButton label="Agent" active={activeTab === "agents"} onClick={() => setActiveTab("agents")} />
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {activeTab === "nodes" && (
          <div className="py-1">
            {tree.length === 0 ? (
              <Empty>暂无节点</Empty>
            ) : (
              tree.map((item) => (
                <button
                  key={item.id}
                  className={`block w-full truncate px-2 py-1 text-left hover:bg-canvas ${
                    selectedNodeId === item.id ? "bg-accent/15 text-accent" : "text-zinc-300"
                  }`}
                  style={{ paddingLeft: 8 + item.depth * 14 }}
                  onClick={() => selectNode(item.id)}
                  title={`${item.title} [${item.type}]`}
                >
                  <span className="text-zinc-600">{item.depth > 0 ? "└ " : ""}</span>
                  <span>{item.title}</span>
                  <span className="ml-1 text-zinc-600">[{item.type}]</span>
                  {item.hasCycle && <span className="ml-1 text-red-400">cycle</span>}
                </button>
              ))
            )}
          </div>
        )}

        {activeTab === "files" && (
          <div className="space-y-1 p-2">
            {nodes.length === 0 ? (
              <Empty>暂无 FileScope</Empty>
            ) : (
              nodes.map((node) => (
                <button
                  key={node.id}
                  className={`w-full rounded border px-2 py-1 text-left ${
                    selectedNodeId === node.id ? "border-accent/60 bg-accent/10" : "border-zinc-800 bg-canvas/40"
                  }`}
                  onClick={() => selectNode(node.id)}
                >
                  <div className="truncate text-zinc-300">{node.title || "Untitled"}</div>
                  <div className="mt-0.5 truncate font-mono text-[11px] text-zinc-500">
                    {scopeSummary(node)}
                  </div>
                </button>
              ))
            )}
          </div>
        )}

        {activeTab === "agents" && (
          <div className="space-y-1 p-2">
            {agentNodes.length === 0 ? (
              <Empty>暂无 Agent 节点</Empty>
            ) : (
              agentNodes.map((node) => (
                <button
                  key={node.id}
                  className={`w-full rounded border px-2 py-1 text-left ${
                    selectedNodeId === node.id ? "border-accent/60 bg-accent/10" : "border-zinc-800 bg-canvas/40"
                  }`}
                  onClick={() => selectNode(node.id)}
                >
                  <div className="truncate text-zinc-300">{node.title || "Untitled"}</div>
                  <div className="text-[11px] text-zinc-500">MVP 中按普通节点执行</div>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      className={`rounded px-2 py-0.5 ${active ? "bg-accent/20 text-accent" : "text-zinc-500 hover:text-zinc-300"}`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function Empty({ children }: { children: string }) {
  return <div className="flex h-28 items-center justify-center text-zinc-600">{children}</div>;
}

function scopeSummary(node: NodeBase): string {
  const allow = node.fileScope?.allow ?? [];
  const deny = node.fileScope?.deny ?? [];
  if (allow.length === 0 && deny.length === 0) return "未限制";
  const parts: string[] = [];
  if (allow.length) parts.push(`allow ${allow.length}: ${allow.slice(0, 2).join(", ")}`);
  if (deny.length) parts.push(`deny ${deny.length}: ${deny.slice(0, 2).join(", ")}`);
  return parts.join(" | ");
}
