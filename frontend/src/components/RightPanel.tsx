import { useEffect, useState } from "react";
import { useGraphStore } from "@/store/graphStore";
import { usePanelStore } from "@/store/panelStore";
import ChatBox from "./ChatBox";
import NodeInspector, { type InspectorView } from "./NodeInspector";

const INSPECTOR_TABS: { key: InspectorView; label: string }[] = [
  { key: "props", label: "属性" },
  { key: "input", label: "输入" },
  { key: "output", label: "输出" },
  { key: "scope", label: "作用域" },
];

export default function RightPanel() {
  const rightOpen = usePanelStore((s) => s.rightOpen);
  const activeTab = usePanelStore((s) => s.rightTab);
  const setActiveTab = usePanelStore((s) => s.setRightTab);
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
  const [inspectorView, setInspectorView] = useState<InspectorView>("props");

  useEffect(() => {
    if (selectedNodeId) setActiveTab("inspector");
  }, [selectedNodeId, setActiveTab]);

  if (!rightOpen) return null;

  return (
    <div className="mag-panel flex h-full flex-col border-l">
      <div className="mag-panel-header flex items-center gap-1 border-b px-2 py-1 text-xs">
        <button
          className={`mag-tab ${
            activeTab === "assistant"
              ? "mag-tab-active"
              : ""
          }`}
          onClick={() => setActiveTab("assistant")}
        >
          助手
        </button>
        <button
          className={`mag-tab ${
            activeTab === "inspector"
              ? "mag-tab-active"
              : ""
          }`}
          onClick={() => setActiveTab("inspector")}
        >
          属性
        </button>
      </div>

      {activeTab === "assistant" ? (
        <div className="min-h-0 flex-1">
          <ChatBox embedded />
        </div>
      ) : (
        <div className="min-h-0 flex-1 flex flex-col">
          <div className="mag-panel-header flex items-center gap-1 border-b px-2 py-1 text-xs overflow-x-auto">
            {INSPECTOR_TABS.map((tab) => (
              <button
                key={tab.key}
                className={`mag-tab ${
                  inspectorView === tab.key
                    ? "mag-tab-active"
                    : ""
                }`}
                onClick={() => setInspectorView(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            <NodeInspector view={inspectorView} />
          </div>
        </div>
      )}
    </div>
  );
}
