import { create } from "zustand";

interface PanelState {
  leftOpen: boolean;
  leftWidth: number;
  rightOpen: boolean;
  rightWidth: number;
  bottomOpen: boolean;
  bottomHeight: number;

  toggleLeft: () => void;
  toggleRight: () => void;
  toggleBottom: () => void;
  setLeftWidth: (w: number) => void;
  setRightWidth: (w: number) => void;
  setBottomHeight: (h: number) => void;
}

export const usePanelStore = create<PanelState>((set) => ({
  leftOpen: true,
  leftWidth: 280,
  rightOpen: true,
  rightWidth: 320,
  bottomOpen: false,
  bottomHeight: 200,

  toggleLeft: () => set((s) => ({ leftOpen: !s.leftOpen })),
  toggleRight: () => set((s) => ({ rightOpen: !s.rightOpen })),
  toggleBottom: () => set((s) => ({ bottomOpen: !s.bottomOpen })),
  setLeftWidth: (w) => set({ leftWidth: w }),
  setRightWidth: (w) => set({ rightWidth: w }),
  setBottomHeight: (h) => set({ bottomHeight: h }),
}));
