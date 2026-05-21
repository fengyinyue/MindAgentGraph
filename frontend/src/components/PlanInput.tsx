import { useState } from "react";
import { planGraph, type Provider } from "@/api/backend";
import { useGraphStore } from "@/store/graphStore";
import { useKeyStore } from "@/store/keyStore";
import { useMonitorStore } from "@/store/monitorStore";
import { DEFAULT_MODELS, useProviderStore } from "@/store/providerStore";

const PROVIDER_OPTIONS: { value: Provider; label: string }[] = [
  { value: "anthropic", label: "Claude" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "local-claude", label: "Local Claude" },
  { value: "local-codex", label: "Local Codex" },
];

export default function PlanInput() {
  const [goal, setGoal] = useState("");
  const provider = useProviderStore((s) => s.provider);
  const setProvider = useProviderStore((s) => s.setProvider);
  const models = useProviderStore((s) => s.models);
  const setModel = useProviderStore((s) => s.setModel);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setGraph = useGraphStore((s) => s.setGraph);
  const apiKey = useKeyStore((s) => s.keys[provider]);
  const model = models[provider] || DEFAULT_MODELS[provider];

  const onSubmit = async () => {
    if (!goal.trim()) return;
    setLoading(true);
    setError(null);
    useMonitorStore.getState().addLog({
      level: "info",
      source: "plan",
      status: "START",
      message: `Planning started with ${provider}/${model}`,
    });
    if (!apiKey && !provider.startsWith("local-")) {
      useMonitorStore.getState().addLog({
        level: "warn",
        source: "provider",
        status: "WARN",
        message: `${provider} API Key 未在前端配置，将使用后端环境变量或离线 demo。`,
      });
    }
    try {
      const graph = await planGraph(goal, { provider, model, apiKey });
      setGraph(graph);
      useMonitorStore.getState().addLog({
        level: "info",
        source: "plan",
        status: "DONE",
        message: `Generated ${graph.nodes.length} nodes / ${graph.links.length} links with ${provider}/${model}`,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      useMonitorStore.getState().addLog({ level: "error", source: "plan", status: "ERROR", message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex gap-2 p-3 bg-panel border-b border-zinc-800 relative">
      <select
        className="bg-canvas border border-zinc-700 rounded px-2 py-2 text-sm outline-none focus:border-accent"
        value={provider}
        onChange={(e) => setProvider(e.target.value as Provider)}
        disabled={loading}
        title="选择模型提供商"
      >
        {PROVIDER_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <input
        className="w-48 bg-canvas border border-zinc-700 rounded px-2 py-2 text-xs outline-none focus:border-accent font-mono"
        value={model}
        onChange={(e) => setModel(provider, e.target.value)}
        disabled={loading}
        placeholder={provider === "local-codex" ? "Codex config default" : "模型名称"}
        title={provider.startsWith("local-") ? "本地 CLI 模型；留空则使用 CLI 默认配置" : "模型名称"}
      />
      <input
        className="flex-1 bg-canvas border border-zinc-700 rounded px-3 py-2 text-sm outline-none focus:border-accent"
        placeholder='输入一句话描述你的项目，例如："做一个 RPG 游戏的城市生成器"'
        value={goal}
        onChange={(e) => setGoal(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onSubmit()}
        disabled={loading}
      />
      <button
        className="px-4 py-2 bg-accent rounded text-sm font-medium disabled:opacity-50"
        onClick={onSubmit}
        disabled={loading}
      >
        {loading ? "Planning..." : "Generate"}
      </button>
      {error && (
        <div className="absolute bottom-2 right-2 bg-red-900/80 text-red-200 text-xs px-3 py-2 rounded">
          {error}
        </div>
      )}
    </div>
  );
}
