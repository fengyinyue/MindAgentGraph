import { create } from "zustand";
import type { NodeBase, Edge, Graph, ProjectMeta } from "@shared/types";

function normalizeNodeType(type: NodeBase["type"]): NodeBase["type"] {
  return type === "planning" ? "workflow_graph" : type;
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
  updateNode: (id: string, patch: Partial<NodeBase>) => void;
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
  updateNode: (id, patch) =>
    set((s) => ({
      nodes: s.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
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
  exitSubgraph: () => set({ activeParentId: null, selectedNodeId: null }),
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
