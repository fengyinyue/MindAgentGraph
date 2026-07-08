import { create } from "zustand";
import type { NodeBase, Edge, Graph, ProjectMeta, NodeType, Position } from "@shared/types";

function normalizeNodeType(type: string): NodeType {
  if (type === "workflow_graph") return "planning";
  if (type === "structure_graph") return "subgraph";
  if (type === "code_analysis" || type === "project_scan") return "analysis";
  return type as NodeType;
}

interface GraphState {
  nodes: NodeBase[];
  links: Edge[];
  selectedNodeId: string | null;
  activeParentId: string | null;
  projectPath: string | null;
  projectDir: string | null;
  projectMeta: ProjectMeta | null;

  setGraph: (graph: Graph) => void;
  setProjectMeta: (meta: ProjectMeta | null) => void;
  addNode: (node: NodeBase) => void;
  addLink: (link: Edge) => void;
  updateLinks: (updater: (links: Edge[]) => Edge[]) => void;
  updateNode: (id: string, patch: Partial<NodeBase>) => void;
  setNodePositions: (positions: Map<string, Position>) => void;
  patchNodeData: (id: string, dataPatch: Record<string, unknown>) => void;
  removeNode: (id: string) => void;
  removeLink: (id: string) => void;
  selectNode: (id: string | null) => void;
  enterSubgraph: (id: string) => void;
  exitSubgraph: () => void;
  setProjectPath: (path: string | null) => void;
  setProjectDir: (dir: string | null) => void;
  clear: () => void;
}

export const useGraphStore = create<GraphState>((set) => ({
  nodes: [],
  links: [],
  selectedNodeId: null,
  activeParentId: null,
  projectPath: null,
  projectDir: null,
  projectMeta: null,

  setGraph: (graph) => set({
    nodes: graph.nodes.map((node) => ({
      ...node,
      type: normalizeNodeType(node.type),
      purpose: node.purpose ?? (typeof node.data?.purpose === "string" ? node.data.purpose : undefined),
      data: node.data ?? {},
      fileScope: node.fileScope ?? { allow: [], deny: [] },
      toolPolicy: node.toolPolicy ?? { tools: [], deny: [] },
      parentId: node.parentId,
      runHistory: node.runHistory ?? [],
      resourceRefs: node.resourceRefs ?? [],
      metadata: node.metadata ?? {},
    })),
    links: graph.links,
    selectedNodeId: null,
    activeParentId: null,
  }),
  setProjectMeta: (meta) => set({ projectMeta: meta }),
  addNode: (node) => set((s) => ({ nodes: [...s.nodes, node] })),
  addLink: (link) => set((s) => ({ links: [...s.links, link] })),
  updateLinks: (updater) => set((s) => ({ links: updater(s.links) })),
  updateNode: (id, patch) =>
    set((s) => ({
      nodes: s.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
    })),
  // Apply new positions only; preserves activeParentId/selection (unlike setGraph).
  setNodePositions: (positions) =>
    set((s) => ({
      nodes: s.nodes.map((n) =>
        positions.has(n.id) ? { ...n, position: positions.get(n.id)! } : n,
      ),
    })),
  patchNodeData: (id, dataPatch) =>
    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, ...dataPatch } } : n,
      ),
    })),
  removeNode: (id) =>
    set((s) => ({
      nodes: s.nodes.filter((n) => n.id !== id && n.parentId !== id),
      links: s.links.filter((e) => {
        const removed = new Set(s.nodes.filter((n) => n.id === id || n.parentId === id).map((n) => n.id));
        return !removed.has(e.source) && !removed.has(e.target);
      }),
      selectedNodeId: s.selectedNodeId === id ? null : s.selectedNodeId,
      activeParentId: s.activeParentId === id ? null : s.activeParentId,
    })),
  removeLink: (id) => set((s) => ({ links: s.links.filter((e) => e.id !== id) })),
  selectNode: (id) => set({ selectedNodeId: id }),
  enterSubgraph: (id) => set((s) => {
    const subgraphNode = s.nodes.find((n) => n.id === id);
    if (!subgraphNode) return { activeParentId: id, selectedNodeId: null };

    // Sync data.children.links → top-level links (visibleEdges only reads top-level).
    const existingChildren = (subgraphNode.data?.children ?? { nodes: [], links: [] }) as {
      nodes: unknown[];
      links: unknown[];
    };
    const childLinks = existingChildren.links as Edge[];
    const topLevelLinkIds = new Set(s.links.map((l) => l.id));
    const missingLinks = childLinks.filter((l) => l.id && !topLevelLinkIds.has(l.id));
    const syncedLinks = missingLinks.length > 0 ? [...s.links, ...missingLinks] : s.links;

    // Sync data.children.nodes → top-level nodes with parentId.
    const childNodes = existingChildren.nodes as NodeBase[];
    const topLevelNodeIds = new Set(s.nodes.map((n) => n.id));
    const missingNodes = childNodes
      .filter((n) => n.id && !topLevelNodeIds.has(n.id))
      .map((n) => ({ ...n, parentId: id }));

    const hasInput = s.nodes.some((n) => n.parentId === id && n.type === "subgraph_input");
    const hasOutput = s.nodes.some((n) => n.parentId === id && n.type === "subgraph_output");

    if (hasInput && hasOutput && missingLinks.length === 0 && missingNodes.length === 0) {
      return { activeParentId: id, selectedNodeId: null };
    }

    const subInputPorts = Array.isArray(subgraphNode.data?.inputs) ? subgraphNode.data.inputs : [];
    const subOutputPorts = Array.isArray(subgraphNode.data?.outputs) ? subgraphNode.data.outputs : [];

    // Compute bounding box of all internal nodes to place boundary nodes adjacent.
    const allInternalNodes = [
      ...s.nodes.filter((n) => n.parentId === id),
      ...missingNodes,
    ];
    const xs = allInternalNodes.map((n) => n.position.x);
    const ys = allInternalNodes.map((n) => n.position.y);
    const minX = xs.length ? Math.min(...xs) : 0;
    const maxX = xs.length ? Math.max(...xs) : 640;
    const midY = ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : 0;

    const inputNodeId  = `${id}_sg_input`;
    const outputNodeId = `${id}_sg_output`;

    const newBoundaryNodes: NodeBase[] = [];
    if (!hasInput) {
      newBoundaryNodes.push({
        id: inputNodeId,
        type: "subgraph_input",
        title: "输入",
        parentId: id,
        position: { x: minX - 320, y: Math.round(midY) },
        contextMode: "inherit",
        fileScope: { allow: [], deny: [] },
        toolPolicy: { tools: [], deny: [] },
        data: { inputs: [], outputs: subInputPorts },
        runHistory: [],
        resourceRefs: [],
        metadata: {},
      });
    }
    if (!hasOutput) {
      newBoundaryNodes.push({
        id: outputNodeId,
        type: "subgraph_output",
        title: "输出",
        parentId: id,
        position: { x: maxX + 320, y: Math.round(midY) },
        contextMode: "inherit",
        fileScope: { allow: [], deny: [] },
        toolPolicy: { tools: [], deny: [] },
        data: { inputs: subOutputPorts, outputs: [] },
        runHistory: [],
        resourceRefs: [],
        metadata: {},
      });
    }

    // Mirror new boundary nodes into data.children for backend execution.
    const updatedChildren = {
      ...existingChildren,
      nodes: [...existingChildren.nodes, ...newBoundaryNodes],
    };

    const updatedNodes = s.nodes
      .map((n) => (n.id === id ? { ...n, data: { ...n.data, children: updatedChildren } } : n))
      .concat(missingNodes, newBoundaryNodes);

    return { nodes: updatedNodes, links: syncedLinks, activeParentId: id, selectedNodeId: null };
  }),
  // Pop up exactly one level (not straight to top), so nested drill-in
  // (plan > subgraph > dataflow) returns to the enclosing container.
  exitSubgraph: () => set((s) => {
    const current = s.activeParentId
      ? s.nodes.find((n) => n.id === s.activeParentId)
      : null;
    return { activeParentId: current?.parentId ?? null, selectedNodeId: null };
  }),
  setProjectPath: (path) => set({ projectPath: path }),
  setProjectDir: (dir) => set({ projectDir: dir }),
  clear: () => set({
    nodes: [],
    links: [],
    selectedNodeId: null,
    activeParentId: null,
    projectPath: null,
    projectMeta: null,
  }),
}));
