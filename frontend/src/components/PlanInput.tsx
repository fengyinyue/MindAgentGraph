import { DEFAULT_MODELS, useProviderStore } from "@/store/providerStore";
import type { Provider } from "@/api/backend";

const PROVIDER_OPTIONS: { value: Provider; label: string }[] = [
  { value: "anthropic", label: "Claude" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "openai", label: "OpenAI / ChatGPT" },
  { value: "local-claude", label: "Local Claude" },
  { value: "local-codex", label: "Local Codex" },
];

export default function PlanInput() {
  const provider = useProviderStore((s) => s.provider);
  const setProvider = useProviderStore((s) => s.setProvider);
  const models = useProviderStore((s) => s.models);
  const setModel = useProviderStore((s) => s.setModel);
  const model = models[provider] || DEFAULT_MODELS[provider];

  return (
    <div className="mag-panel-header flex gap-2 items-center p-2 border-b text-xs">
      <span className="text-zinc-500">Provider:</span>
      <select
        className="mag-input px-2 py-1 text-xs"
        value={provider}
        onChange={(e) => setProvider(e.target.value as Provider)}
        title="选择模型提供商"
      >
        {PROVIDER_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <input
        className="mag-input w-40 px-2 py-1 text-xs font-mono"
        value={model}
        onChange={(e) => setModel(provider, e.target.value)}
        placeholder={provider.startsWith("local-") ? "CLI default" : "model name"}
        title={provider.startsWith("local-") ? "本地 CLI 模型；留空则使用 CLI 默认配置" : "模型名称"}
      />
    </div>
  );
}
