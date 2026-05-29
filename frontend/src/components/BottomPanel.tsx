import { Fragment, useEffect, useState } from "react";
import { usePanelStore } from "@/store/panelStore";
import { useGraphStore } from "@/store/graphStore";
import BottomMonitor, { type MonitorTab } from "./BottomMonitor";
import NodeInspector, { type InspectorView } from "./NodeInspector";

type Tab = InspectorView | MonitorTab;

const TABS: { key: Tab; label: string }[] = [
  { key: "props", label: "属性" },
  { key: "output", label: "输出" },
  { key: "scope", label: "作用域" },
  { key: "logs", label: "AI 日志" },
  { key: "errors", label: "错误" },
  { key: "tokens", label: "Token" },
  { key: "progress", label: "进度" },
];

const INSPECTOR_VIEWS: ReadonlySet<Tab> = new Set<Tab>(["props", "output", "scope"]);

export default function BottomPanel() {
  const bottomOpen = usePanelStore((s) => s.bottomOpen);
  const toggleBottom = usePanelStore((s) => s.toggleBottom);
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
  const [activeTab, setActiveTab] = useState<Tab>("props");

  // 选中节点时自动展开底部并切到属性 tab（除非已经在某个 inspector 子 tab 上）
  useEffect(() => {
    if (!selectedNodeId) return;
    setActiveTab((prev) => (INSPECTOR_VIEWS.has(prev) ? prev : "props"));
  }, [selectedNodeId]);

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
      <div className="flex items-center px-3 py-1 border-b border-zinc-800 text-xs gap-1 overflow-x-auto">
        {TABS.map((t, idx) => (
          <Fragment key={t.key}>
            {idx === 3 && <span className="mx-1 h-3 w-px bg-zinc-700 shrink-0" />}
            <button
              className={`px-2 py-0.5 rounded shrink-0 ${
                activeTab === t.key
                  ? "bg-accent/20 text-accent"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
              onClick={() => setActiveTab(t.key)}
            >
              {t.label}
            </button>
          </Fragment>
        ))}
        <button
          className="ml-auto text-zinc-500 hover:text-accent shrink-0"
          onClick={toggleBottom}
          title="折叠底部面板"
        >
          &#9660;
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        {INSPECTOR_VIEWS.has(activeTab) ? (
          <NodeInspector view={activeTab as InspectorView} />
        ) : (
          <BottomMonitor activeTab={activeTab as MonitorTab} />
        )}
      </div>
    </div>
  );
}
