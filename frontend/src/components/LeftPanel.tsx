import { usePanelStore } from "@/store/panelStore";
import ProjectExplorer from "./ProjectExplorer";

export default function LeftPanel() {
  const leftOpen = usePanelStore((s) => s.leftOpen);

  if (!leftOpen) return null;

  return (
    <div className="bg-panel border-r border-zinc-800 flex flex-col h-full">
      <div className="flex items-center px-3 py-1.5 border-b border-zinc-800 text-xs">
        <span className="font-semibold text-zinc-300">项目浏览器</span>
      </div>
      <div className="min-h-0 flex-1">
        <ProjectExplorer />
      </div>
    </div>
  );
}
