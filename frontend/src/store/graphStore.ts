import { create } from "zustand";
import type { NodeBase, Edge, Graph } from "@shared/types";

interface GraphState {
  nodes: NodeBase[];
  links: Edge[];
  selectedNodeId: string | null;
  projectPath: string | null;

  setGraph: (graph: Graph) => void;
  addNode: (node: NodeBase) => void;
  updateNode: (id: string, patch: Partial<NodeBase>) => void;
  removeNode: (id: string) => void;
  selectNode: (id: string | null) => void;
  setProjectPath: (path: string | null) => void;
  clear: () => void;
}

export const useGraphStore = create<GraphState>((set) => ({
  nodes: [],
  links: [],
  selectedNodeId: null,
  projectPath: null,

  setGraph: (graph) => set({ nodes: graph.nodes, links: graph.links }),
  addNode: (node) => set((s) => ({ nodes: [...s.nodes, node] })),
  updateNode: (id, patch) =>
    set((s) => ({
      nodes: s.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
    })),
  removeNode: (id) =>
    set((s) => ({
      nodes: s.nodes.filter((n) => n.id !== id),
      links: s.links.filter((e) => e.source !== id && e.target !== id),
    })),
  selectNode: (id) => set({ selectedNodeId: id }),
  setProjectPath: (path) => set({ projectPath: path }),
  clear: () => set({ nodes: [], links: [], selectedNodeId: null }),
}));
