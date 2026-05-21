import { usePanelStore } from "@/store/panelStore";
import ProjectExplorer from "./ProjectExplorer";

export default function LeftPanel() {
  const leftOpen = usePanelStore((s) => s.leftOpen);
  const toggleLeft = usePanelStore((s) => s.toggleLeft);

  if (!leftOpen) {
    return (
      <div className="bg-panel border-r border-zinc-800 flex flex-col items-center py-2" style={{ width: 32 }}>
        <button
          className="text-zinc-500 hover:text-accent text-sm leading-none"
          onClick={toggleLeft}
          title="展开左侧面板"
        >
          &#9654;
        </button>
      </div>
    );
  }

  return (
    <div className="bg-panel border-r border-zinc-800 flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-zinc-800 text-xs">
        <span className="font-semibold text-zinc-300">项目浏览器</span>
        <button
          className="text-zinc-500 hover:text-accent"
          onClick={toggleLeft}
          title="折叠左侧面板"
        >
          &#9664;
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <ProjectExplorer />
      </div>
    </div>
  );
}
