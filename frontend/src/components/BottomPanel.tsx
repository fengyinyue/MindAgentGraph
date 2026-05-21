import { useState } from "react";
import { usePanelStore } from "@/store/panelStore";
import BottomMonitor, { BottomMonitorTabs } from "./BottomMonitor";

type Tab = "logs" | "errors" | "tokens" | "progress";

export default function BottomPanel() {
  const bottomOpen = usePanelStore((s) => s.bottomOpen);
  const toggleBottom = usePanelStore((s) => s.toggleBottom);
  const [activeTab, setActiveTab] = useState<Tab>("logs");

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
        <BottomMonitorTabs activeTab={activeTab} onTabChange={setActiveTab} />
        <button
          className="ml-auto text-zinc-500 hover:text-accent"
          onClick={toggleBottom}
          title="折叠底部面板"
        >
          &#9660;
        </button>
      </div>
      <div className="flex-1 min-h-0">
        <BottomMonitor activeTab={activeTab} />
      </div>
    </div>
  );
}
