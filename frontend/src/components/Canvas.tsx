import { useMemo, useCallback } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node as RFNode,
  type Edge as RFEdge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useGraphStore } from "@/store/graphStore";
import type { NodeBase } from "@shared/types";

const typeColor: Record<string, string> = {
  prompt: "#6c8eef",
  planning: "#9b6cef",
  memory: "#ef9b6c",
  filescope: "#6cefb6",
  code: "#ef6c8e",
  api: "#efef6c",
  asset: "#ef6cef",
  agent: "#6cefef",
  task: "#bcef6c",
  semantic: "#a0a0a0",
};

export default function Canvas() {
  const nodes = useGraphStore((s) => s.nodes);
  const links = useGraphStore((s) => s.links);
  const selectNode = useGraphStore((s) => s.selectNode);

  const rfNodes: RFNode[] = useMemo(
    () =>
      nodes.map((n: NodeBase) => ({
        id: n.id,
        position: n.position,
        data: { label: `${n.title}\n[${n.type}]` },
        style: {
          borderLeft: `3px solid ${typeColor[n.type] || "#999"}`,
          whiteSpace: "pre-line",
        },
      })),
    [nodes]
  );

  const rfEdges: RFEdge[] = useMemo(
    () =>
      links.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
        animated: true,
      })),
    [links]
  );

  const onNodeClick = useCallback(
    (_: unknown, node: RFNode) => selectNode(node.id),
    [selectNode]
  );

  return (
    <ReactFlow
      nodes={rfNodes}
      edges={rfEdges}
      onNodeClick={onNodeClick}
      fitView
      proOptions={{ hideAttribution: true }}
    >
      <Background color="#1f2330" gap={20} />
      <Controls className="!bg-panel !border-none" />
      <MiniMap
        className="!bg-panel"
        nodeColor={(n) => {
          const original = nodes.find((x) => x.id === n.id);
          return original ? typeColor[original.type] || "#666" : "#666";
        }}
      />
    </ReactFlow>
  );
}
