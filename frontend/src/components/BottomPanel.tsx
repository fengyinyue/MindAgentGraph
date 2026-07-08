import { useState } from "react";
import { usePanelStore } from "@/store/panelStore";
import BottomMonitor, { type MonitorTab } from "./BottomMonitor";

const TABS: { key: MonitorTab; label: string }[] = [
  { key: "logs", label: "AI 日志" },
  { key: "errors", label: "错误" },
  { key: "tokens", label: "Token" },
  { key: "progress", label: "进度" },
];

export default function BottomPanel() {
  const bottomOpen = usePanelStore((s) => s.bottomOpen);
  const [activeTab, setActiveTab] = useState<MonitorTab>("logs");

  if (!bottomOpen) return null;

  return (
    <div className="bg-panel border-t border-zinc-800 flex flex-col h-full">
      <div className="flex items-center px-3 py-1 border-b border-zinc-800 text-xs gap-1 overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            className={`px-2 py-0.5 rounded shrink-0 ${
              activeTab === tab.key
                ? "bg-accent/20 text-accent"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        <BottomMonitor activeTab={activeTab} />
      </div>
    </div>
  );
}
