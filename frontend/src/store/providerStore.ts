import { create } from "zustand";
import type { Provider } from "@/api/backend";

const STORAGE_KEY = "mag.provider.v1";
const MODEL_STORAGE_KEY = "mag.providerModels.v1";

export const DEFAULT_MODELS: Record<Provider, string> = {
  anthropic: "claude-sonnet-4-6",
  deepseek: "deepseek-chat",
  openai: "gpt-4.1",
  "local-claude": "sonnet",
  "local-codex": "",
};

function loadInitial(): Provider {
  if (typeof window === "undefined") return "anthropic";
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === "anthropic" || raw === "deepseek" || raw === "openai" || raw === "local-claude" || raw === "local-codex") return raw;
  } catch {
    /* ignore */
  }
  return "anthropic";
}

function loadModels(): Partial<Record<Provider, string>> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(MODEL_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed ? parsed : {};
  } catch {
    return {};
  }
}

interface ProviderState {
  provider: Provider;
  models: Partial<Record<Provider, string>>;
  setProvider: (p: Provider) => void;
  setModel: (provider: Provider, model: string) => void;
  getModel: (provider?: Provider) => string | undefined;
}

export const useProviderStore = create<ProviderState>((set, get) => ({
  provider: loadInitial(),
  models: loadModels(),
  setProvider: (provider) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, provider);
    } catch {
      /* quota / disabled — ignore */
    }
    set({ provider });
  },
  setModel: (provider, model) =>
    set((s) => {
      const next = { ...s.models, [provider]: model.trim() };
      try {
        window.localStorage.setItem(MODEL_STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return { models: next };
    }),
  getModel: (provider) => {
    const p = provider ?? get().provider;
    return get().models[p] || DEFAULT_MODELS[p];
  },
}));
