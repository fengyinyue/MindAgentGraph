import { create } from "zustand";
import type { NodeBase, Edge, Graph } from "@shared/types";

interface GraphState {
  nodes: NodeBase[];
  links: Edge[];
  selectedNodeId: string | null;
  projectPath: string | null;
  projectDir: string | null;

  setGraph: (graph: Graph) => void;
  addNode: (node: NodeBase) => void;
  updateNode: (id: string, patch: Partial<NodeBase>) => void;
  patchNodeData: (id: string, dataPatch: Record<string, unknown>) => void;
  removeNode: (id: string) => void;
  selectNode: (id: string | null) => void;
  setProjectPath: (path: string | null) => void;
  setProjectDir: (dir: string | null) => void;
  clear: () => void;
}

export const useGraphStore = create<GraphState>((set) => ({
  nodes: [],
  links: [],
  selectedNodeId: null,
  projectPath: null,
  projectDir: null,

  setGraph: (graph) => set({
    nodes: graph.nodes.map((node) => ({
      ...node,
      purpose: node.purpose ?? (typeof node.data?.purpose === "string" ? node.data.purpose : undefined),
      data: node.data ?? {},
      fileScope: node.fileScope ?? { allow: [], deny: [] },
      toolPolicy: node.toolPolicy ?? { tools: [], deny: [] },
      runHistory: node.runHistory ?? [],
      resourceRefs: node.resourceRefs ?? [],
      metadata: node.metadata ?? {},
    })),
    links: graph.links,
  }),
  addNode: (node) => set((s) => ({ nodes: [...s.nodes, node] })),
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
      nodes: s.nodes.filter((n) => n.id !== id),
      links: s.links.filter((e) => e.source !== id && e.target !== id),
      selectedNodeId: s.selectedNodeId === id ? null : s.selectedNodeId,
    })),
  selectNode: (id) => set({ selectedNodeId: id }),
  setProjectPath: (path) => set({ projectPath: path }),
  setProjectDir: (dir) => set({ projectDir: dir }),
  clear: () => set({ nodes: [], links: [], selectedNodeId: null }),
}));
