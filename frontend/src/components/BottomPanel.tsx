import { useState } from "react";
import { usePanelStore } from "@/store/panelStore";

type Tab = "logs" | "comm" | "tokens";

export default function BottomPanel() {
  const bottomOpen = usePanelStore((s) => s.bottomOpen);
  const toggleBottom = usePanelStore((s) => s.toggleBottom);
  const [activeTab, setActiveTab] = useState<Tab>("logs");

  const tabs: { key: Tab; label: string }[] = [
    { key: "logs", label: "AI 日志" },
    { key: "comm", label: "Agent 通信" },
    { key: "tokens", label: "Token 使用" },
  ];

  if (!bottomOpen) {
    return (
      <div className="bg-panel border-t border-zinc-800 flex items-center justify-center" style={{ height: 28 }}>
        <button
          className="text-zinc-500 hover:text-accent text-xs"
          onClick={toggleBottom}
          title="展开底部面板"
        >
          &#9650;
        </button>
      </div>
    );
  }

  return (
    <div className="bg-panel border-t border-zinc-800 flex flex-col h-full">
      <div className="flex items-center px-3 py-1 border-b border-zinc-800 text-xs">
        {tabs.map((t) => (
          <button
            key={t.key}
            className={`px-2 py-0.5 rounded ${
              activeTab === t.key
                ? "bg-accent/20 text-accent"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
            onClick={() => setActiveTab(t.key)}
          >
            {t.label}
          </button>
        ))}
        <button
          className="ml-auto text-zinc-500 hover:text-accent"
          onClick={toggleBottom}
          title="折叠底部面板"
        >
          &#9660;
        </button>
      </div>
      <div className="flex-1 flex items-center justify-center text-xs text-zinc-500">
        {activeTab === "logs" && "AI 日志（即将实现）"}
        {activeTab === "comm" && "Agent 通信记录（即将实现）"}
        {activeTab === "tokens" && "Token 统计（即将实现）"}
      </div>
    </div>
  );
}
