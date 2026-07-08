import { create } from "zustand";

interface PanelState {
  leftOpen: boolean;
  leftWidth: number;
  rightOpen: boolean;
  rightWidth: number;
  rightTab: "assistant" | "inspector";
  bottomOpen: boolean;
  bottomHeight: number;

  toggleLeft: () => void;
  toggleRight: () => void;
  toggleBottom: () => void;
  setRightTab: (tab: "assistant" | "inspector") => void;
  setLeftWidth: (w: number) => void;
  setRightWidth: (w: number) => void;
  setBottomHeight: (h: number) => void;
}

export const usePanelStore = create<PanelState>((set) => ({
  leftOpen: true,
  leftWidth: 280,
  rightOpen: true,
  rightWidth: 320,
  rightTab: "assistant",
  bottomOpen: true,
  bottomHeight: 200,

  toggleLeft: () => set((s) => ({ leftOpen: !s.leftOpen })),
  toggleRight: () => set((s) => ({ rightOpen: !s.rightOpen })),
  toggleBottom: () => set((s) => ({ bottomOpen: !s.bottomOpen })),
  setRightTab: (tab) => set({ rightTab: tab }),
  setLeftWidth: (w) => set({ leftWidth: w }),
  setRightWidth: (w) => set({ rightWidth: w }),
  setBottomHeight: (h) => set({ bottomHeight: h }),
}));
