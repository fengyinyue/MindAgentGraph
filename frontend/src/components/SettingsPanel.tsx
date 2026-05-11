import { useEffect, useState } from "react";
import { useKeyStore } from "@/store/keyStore";
import type { Provider } from "@/api/backend";

interface ProviderInfo {
  id: Provider;
  label: string;
  hint: string;
  placeholder: string;
}

const PROVIDERS: ProviderInfo[] = [
  {
    id: "anthropic",
    label: "Anthropic Claude",
    hint: "在 console.anthropic.com 创建。仅本机 localStorage 存储，不上传服务器。",
    placeholder: "sk-ant-...",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    hint: "在 platform.deepseek.com 创建。OpenAI 兼容端点，仅 deepseek-chat 支持工具调用。",
    placeholder: "sk-...",
  },
];

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function SettingsPanel({ open, onClose }: Props) {
  // ESC closes panel
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 bg-black/40 z-40"
        onClick={onClose}
        aria-hidden
      />
      <aside
        className="fixed top-0 right-0 h-full w-[420px] bg-panel border-l border-zinc-800 z-50 shadow-2xl flex flex-col"
        role="dialog"
        aria-label="Settings"
      >
        <header className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <h2 className="text-sm font-semibold">Settings · API Keys</h2>
          <button
            className="text-zinc-400 hover:text-white text-lg leading-none"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          <p className="text-xs text-zinc-500 leading-relaxed">
            Key 仅保存在浏览器 localStorage，不会写入工程文件、不会上传到任何服务器。
            调用 /plan 时通过请求头一次性发给本地后端。
            清除 key 后会回退到后端环境变量；都没有则使用离线 demo 数据。
          </p>
          {PROVIDERS.map((p) => (
            <KeyRow key={p.id} info={p} />
          ))}
        </div>
      </aside>
    </>
  );
}

function KeyRow({ info }: { info: ProviderInfo }) {
  const stored = useKeyStore((s) => s.keys[info.id]);
  const setKey = useKeyStore((s) => s.setKey);
  const clearKey = useKeyStore((s) => s.clearKey);

  const [draft, setDraft] = useState(stored ?? "");
  const [reveal, setReveal] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setDraft(stored ?? "");
  }, [stored]);

  const onSave = () => {
    if (!draft.trim()) return;
    setKey(info.id, draft);
    setSaved(true);
    setTimeout(() => setSaved(false), 1200);
  };

  const onClear = () => {
    clearKey(info.id);
    setDraft("");
  };

  const masked = stored ? `${stored.slice(0, 6)}…${stored.slice(-4)}` : "(unset)";

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium">{info.label}</label>
        <span className="text-xs text-zinc-500 font-mono">{masked}</span>
      </div>
      <div className="flex gap-2">
        <input
          type={reveal ? "text" : "password"}
          className="flex-1 bg-canvas border border-zinc-700 rounded px-3 py-2 text-xs font-mono outline-none focus:border-accent"
          placeholder={info.placeholder}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onSave()}
          autoComplete="off"
          spellCheck={false}
        />
        <button
          className="px-2 text-xs text-zinc-400 hover:text-white"
          onClick={() => setReveal((r) => !r)}
          title={reveal ? "Hide" : "Show"}
        >
          {reveal ? "🙈" : "👁"}
        </button>
      </div>
      <div className="flex gap-2 text-xs">
        <button
          className="px-3 py-1 bg-accent rounded disabled:opacity-50"
          onClick={onSave}
          disabled={!draft.trim() || draft === stored}
        >
          {saved ? "Saved ✓" : "Save"}
        </button>
        {stored && (
          <button
            className="px-3 py-1 border border-zinc-700 rounded hover:border-red-500 hover:text-red-400"
            onClick={onClear}
          >
            Clear
          </button>
        )}
      </div>
      <p className="text-[11px] text-zinc-600 leading-relaxed">{info.hint}</p>
    </div>
  );
}
