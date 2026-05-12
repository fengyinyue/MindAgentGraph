import { useCallback, useRef } from "react";
import { create } from "zustand";
import { runNodeStream } from "@/api/backend";
import { useGraphStore } from "@/store/graphStore";
import { useKeyStore } from "@/store/keyStore";
import { useProviderStore } from "@/store/providerStore";

interface RunState {
  runningId: string | null;
  setRunning: (id: string | null) => void;
}

// Module-level so the running indicator is consistent across components
// (Canvas dim other nodes, NodeInspector show spinner, etc.).
const useRunState = create<RunState>((set) => ({
  runningId: null,
  setRunning: (id) => set({ runningId: id }),
}));

interface RunOptions {
  userPrompt?: string;
}

export function useRunNode() {
  const runningId = useRunState((s) => s.runningId);
  const setRunning = useRunState((s) => s.setRunning);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(
    async (nodeId: string, opts: RunOptions = {}) => {
      const state = useGraphStore.getState();
      const node = state.nodes.find((n) => n.id === nodeId);
      if (!node) return;
      if (useRunState.getState().runningId) return; // already running

      const provider = useProviderStore.getState().provider;
      const apiKey = useKeyStore.getState().keys[provider];

      // Reset output before streaming.
      state.patchNodeData(nodeId, { output: "", error: undefined });
      setRunning(nodeId);

      const ctrl = new AbortController();
      abortRef.current = ctrl;

      let acc = "";
      await runNodeStream(
        {
          node: {
            title: node.title,
            type: node.type,
            purpose: (node.data?.purpose as string | undefined) ?? "",
          },
          userPrompt: opts.userPrompt,
          provider,
          apiKey,
        },
        {
          onText: (chunk) => {
            acc += chunk;
            useGraphStore.getState().patchNodeData(nodeId, { output: acc });
          },
          onDone: () => {
            setRunning(null);
            abortRef.current = null;
          },
          onError: (message) => {
            useGraphStore.getState().patchNodeData(nodeId, { error: message });
            setRunning(null);
            abortRef.current = null;
          },
          signal: ctrl.signal,
        },
      );
    },
    [setRunning],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setRunning(null);
  }, [setRunning]);

  return { run, cancel, runningId };
}
