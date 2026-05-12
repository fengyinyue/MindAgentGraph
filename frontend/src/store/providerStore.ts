import { create } from "zustand";
import type { Provider } from "@/api/backend";

const STORAGE_KEY = "mag.provider.v1";

function loadInitial(): Provider {
  if (typeof window === "undefined") return "anthropic";
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === "anthropic" || raw === "deepseek") return raw;
  } catch {
    /* ignore */
  }
  return "anthropic";
}

interface ProviderState {
  provider: Provider;
  setProvider: (p: Provider) => void;
}

export const useProviderStore = create<ProviderState>((set) => ({
  provider: loadInitial(),
  setProvider: (provider) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, provider);
    } catch {
      /* quota / disabled — ignore */
    }
    set({ provider });
  },
}));
