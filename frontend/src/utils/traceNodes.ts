// Materialize a code node's recorded tool trace into editable/replayable
// `tool` child nodes inside that code node (execution layer, no ports).
// Shared by the auto-materialize-on-run path (useRunNode) and Promote.

import { useGraphStore } from "@/store/graphStore";
import type { Edge, NodeBase, ToolTraceItem } from "@shared/types";

export function tracePurpose(trace: ToolTraceItem): string {
  const input = JSON.stringify(trace.input ?? {}, null, 2);
  const parts = [
    `Tool call ${trace.step}: ${trace.tool}`,
    `Status: ${trace.status}`,
    input && input !== "{}" ? `Input:\n${input}` : "",
    trace.outputSummary ? `Output:\n${trace.outputSummary}` : "",
    trace.error ? `Error:\n${trace.error}` : "",
    trace.affectedFiles?.length ? `Affected files: ${trace.affectedFiles.join(", ")}` : "",
  ].filter(Boolean);
  return parts.join("\n\n");
}

interface TraceRun {
  id: string;
  toolTrace?: ToolTraceItem[];
}

/**
 * (Re)generate the tool subgraph inside `nodeId` from `run`'s tool trace.
 * Removes any previous trace nodes for this source node first. Does NOT
 * navigate into the subgraph — the nodes just appear inside, drill in to view.
 * Returns true if nodes were generated.
 */
export function materializeTraceNodes(nodeId: string, run: TraceRun | undefined): boolean {
  const trace = run?.toolTrace ?? [];
  if (!run || trace.length === 0) return false;
  const store = useGraphStore.getState();
  const sourceNode = store.nodes.find((n) => n.id === nodeId);
  if (!sourceNode) return false;

  const oldTraceNodeIds = store.nodes
    .filter((item) => item.metadata?.traceSourceNodeId === nodeId)
    .map((item) => item.id);
  for (const oldId of oldTraceNodeIds) store.removeNode(oldId);

  const ordered = [...trace].sort((a, b) => a.step - b.step);
  const newNodes: NodeBase[] = ordered.map((t, idx) => ({
    id: crypto.randomUUID(),
    type: "tool",
    title: `${t.step}. ${t.tool}`,
    position: { x: idx * 280, y: t.status === "error" ? 120 : 0 },
    contextMode: "explicit",
    fileScope: { allow: [], deny: [] },
    toolPolicy: { tools: [], deny: [] },
    parentId: nodeId,
    purpose: tracePurpose(t),
    data: {
      purpose: tracePurpose(t),
      tool: t.tool,
      toolInput: t.input ?? {},
      order: t.step,
      status: t.status,
      lastOutput: t.output ?? t.outputSummary,
      trace: t,
    },
    runHistory: [],
    resourceRefs: [],
    metadata: {
      traceNode: true,
      traceRunId: run.id,
      traceToolId: t.id,
      traceSourceNodeId: nodeId,
    },
  }));
  const newLinks: Edge[] = newNodes.slice(1).map((child, idx) => ({
    id: crypto.randomUUID(),
    source: newNodes[idx].id,
    target: child.id,
    label: "next",
  }));
  for (const child of newNodes) store.addNode(child);
  for (const link of newLinks) store.addLink(link);
  store.patchNodeData(nodeId, {
    traceSubgraphRunId: run.id,
    traceSubgraphUpdatedAt: new Date().toISOString(),
  });
  return true;
}
