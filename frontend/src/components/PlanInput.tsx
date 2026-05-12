import { useState } from "react";
import { planGraph, type Provider } from "@/api/backend";
import { useGraphStore } from "@/store/graphStore";
import { useKeyStore } from "@/store/keyStore";
import { useProviderStore } from "@/store/providerStore";

const PROVIDER_OPTIONS: { value: Provider; label: string }[] = [
  { value: "anthropic", label: "Claude" },
  { value: "deepseek", label: "DeepSeek" },
];

export default function PlanInput() {
  const [goal, setGoal] = useState("");
  const provider = useProviderStore((s) => s.provider);
  const setProvider = useProviderStore((s) => s.setProvider);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setGraph = useGraphStore((s) => s.setGraph);
  const apiKey = useKeyStore((s) => s.keys[provider]);

  const onSubmit = async () => {
    if (!goal.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const graph = await planGraph(goal, { provider, apiKey });
      setGraph(graph);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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
