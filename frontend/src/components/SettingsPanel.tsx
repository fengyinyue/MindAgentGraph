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
    hint: "在 platform.deepseek.com 创建。OpenAI 兼容端点，默认使用 deepseek-v4-flash。",
    placeholder: "sk-...",
  },
  {
    id: "openai",
    label: "OpenAI / ChatGPT",
    hint: "在 platform.openai.com 创建。仅本机 localStorage 存储，不上传服务器。",
    placeholder: "sk-...",
  },
];

const LOCAL_PROVIDERS: ProviderInfo[] = [
  {
    id: "local-claude",
    label: "Local Claude CLI",
    hint: "使用本机已配置的 `claude`/`claude.cmd`。无需 API Key，可用 MAG_LOCAL_CLAUDE_CMD 覆盖命令。",
    placeholder: "",
  },
  {
    id: "local-codex",
    label: "Local Codex CLI",
    hint: "使用本机已登录的 `codex exec`。无需 API Key，可用 MAG_LOCAL_CODEX_CMD 覆盖命令。",
    placeholder: "",
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
        className="fixed inset-0 bg-black/50 z-40 backdrop-blur-[1px]"
        onClick={onClose}
        aria-hidden
      />
      <aside
        className="mag-panel fixed top-0 right-0 z-50 flex h-full w-[420px] flex-col border-l shadow-2xl"
        role="dialog"
        aria-label="Settings"
      >
        <header className="mag-panel-header flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-sm font-semibold">Settings · API Keys</h2>
          <button
            className="mag-button mag-button-icon text-lg leading-none"
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
          <div className="border-t border-zinc-800/80 pt-4 space-y-3">
            <h3 className="text-sm font-semibold">Local CLI Providers</h3>
            {LOCAL_PROVIDERS.map((p) => (
              <div key={p.id} className="mag-list-item p-3">
                <div className="text-sm font-medium">{p.label}</div>
                <p className="mt-1 text-[11px] text-zinc-600 leading-relaxed">{p.hint}</p>
              </div>
            ))}
          </div>
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
          className="mag-input flex-1 px-3 py-2 text-xs font-mono"
          placeholder={info.placeholder}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onSave()}
          autoComplete="off"
          spellCheck={false}
        />
        <button
          className="mag-button mag-button-icon"
          onClick={() => setReveal((r) => !r)}
          title={reveal ? "Hide" : "Show"}
        >
          {reveal ? "🙈" : "👁"}
        </button>
      </div>
      <div className="flex gap-2 text-xs">
        <button
          className="mag-button mag-button-primary"
          onClick={onSave}
          disabled={!draft.trim() || draft === stored}
        >
          {saved ? "Saved ✓" : "Save"}
        </button>
        {stored && (
          <button
            className="mag-button hover:border-red-500 hover:text-red-400"
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
