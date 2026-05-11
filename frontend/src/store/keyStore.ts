import { create } from "zustand";
import type { Provider } from "@/api/backend";

// localStorage 仅前端独占；不进 .mag 工程文件，不发到 server 持久化。
// 调用 /plan 时通过 X-Provider-Key header 发给后端单次使用。
const STORAGE_KEY = "mag.providerKeys.v1";

type Keys = Partial<Record<Provider, string>>;

function loadInitial(): Keys {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed ? parsed : {};
  } catch {
    return {};
  }
}

function persist(keys: Keys): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
  } catch {
    /* quota / disabled — silently ignore */
  }
}

interface KeyState {
  keys: Keys;
  setKey: (provider: Provider, key: string) => void;
  clearKey: (provider: Provider) => void;
  getKey: (provider: Provider) => string | undefined;
}

export const useKeyStore = create<KeyState>((set, get) => ({
  keys: loadInitial(),
  setKey: (provider, key) =>
    set((s) => {
      const next = { ...s.keys, [provider]: key.trim() };
      persist(next);
      return { keys: next };
    }),
  clearKey: (provider) =>
    set((s) => {
      const next = { ...s.keys };
      delete next[provider];
      persist(next);
      return { keys: next };
    }),
  getKey: (provider) => get().keys[provider],
}));
