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
    <div className="mag-panel flex flex-col h-full border-t">
      <div className="mag-panel-header flex items-center px-3 py-1 border-b text-xs gap-1 overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            className={`mag-tab ${
              activeTab === tab.key
                ? "mag-tab-active"
                : ""
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
