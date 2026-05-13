import { useCallback, useRef } from "react";
import { create } from "zustand";
import { runNodeStream, runNodeCode } from "@/api/backend";
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

  const runCode = useCallback(
    async (nodeId: string, opts: RunOptions = {}) => {
      const state = useGraphStore.getState();
      const node = state.nodes.find((n) => n.id === nodeId);
      if (!node) return;
      if (useRunState.getState().runningId) return;

      const projectDir = state.projectDir;
      if (!projectDir) {
        state.patchNodeData(nodeId, { codeError: "未设置工程目录，请先在工具栏点 📁 选择" });
        return;
      }

      // Collect parent outputs from dependency chain.
      const parentOutputs: Record<string, string> = {};
      for (const link of state.links) {
        if (link.target === nodeId) {
          const parent = state.nodes.find((n) => n.id === link.source);
          if (parent?.data?.output) {
            parentOutputs[parent.id] = String(parent.data.output);
          }
        }
      }

      const provider = useProviderStore.getState().provider;
      // Code run goes through Claude Code CLI, not provider API.
      // But we can pass a model preference.

      state.patchNodeData(nodeId, { codeOutput: "", codeError: undefined, generatedFiles: undefined });
      setRunning(nodeId);

      const ctrl = new AbortController();
      abortRef.current = ctrl;

      let acc = "";
      await runNodeCode(
        {
          node: {
            title: node.title,
            type: node.type,
            purpose: (node.data?.purpose as string | undefined) ?? "",
          },
          projectDir,
          fileScopeAllow: node.fileScope.allow,
          fileScopeDeny: node.fileScope.deny,
          parentOutputs: Object.keys(parentOutputs).length ? parentOutputs : undefined,
          userPrompt: opts.userPrompt,
        },
        {
          onText: (chunk) => {
            acc += chunk;
            useGraphStore.getState().patchNodeData(nodeId, { codeOutput: acc });
          },
          onFiles: (files) => {
            useGraphStore.getState().patchNodeData(nodeId, { generatedFiles: files });
          },
          onDone: () => {
            setRunning(null);
            abortRef.current = null;
          },
          onError: (message) => {
            useGraphStore.getState().patchNodeData(nodeId, { codeError: message });
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

  return { run, runCode, cancel, runningId };
}
