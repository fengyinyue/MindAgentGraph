import { usePanelStore } from "@/store/panelStore";
import ProjectExplorer from "./ProjectExplorer";

export default function LeftPanel() {
  const leftOpen = usePanelStore((s) => s.leftOpen);

  if (!leftOpen) return null;

  return (
    <div className="mag-panel flex flex-col h-full border-r">
      <div className="mag-panel-header flex items-center px-3 py-1.5 border-b text-xs">
        <span className="font-semibold text-zinc-300">项目浏览器</span>
      </div>
      <div className="min-h-0 flex-1">
        <ProjectExplorer />
      </div>
    </div>
  );
}
