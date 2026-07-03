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
  enterSubgraph: (id) => set({ activeParentId: id, selectedNodeId: null }),
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
