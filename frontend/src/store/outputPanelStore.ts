import { create } from "zustand";

interface OutputPanelState {
  nodeId: string | null;
  mode: "explain" | "code";
  open: (nodeId: string, mode?: "explain" | "code") => void;
  close: () => void;
}

export const useOutputPanelStore = create<OutputPanelState>((set) => ({
  nodeId: null,
  mode: "explain",
  open: (nodeId, mode = "explain") => set({ nodeId, mode }),
  close: () => set({ nodeId: null }),
}));
