import { useState } from "react";
import { useGraphStore } from "@/store/graphStore";
import { openProjectDialog, saveProjectDialog } from "@/api/project";
import SettingsPanel from "./SettingsPanel";

export default function Toolbar() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const setGraph = useGraphStore((s) => s.setGraph);
  const setProjectPath = useGraphStore((s) => s.setProjectPath);
  const projectPath = useGraphStore((s) => s.projectPath);
  const nodes = useGraphStore((s) => s.nodes);
  const links = useGraphStore((s) => s.links);

  const onOpen = async () => {
    try {
      const payload = await openProjectDialog();
      if (!payload) return;
      setGraph(payload.graph);
      setProjectPath(null);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  const onSave = async () => {
    try {
      const path = await saveProjectDialog({ nodes, links });
      if (path) setProjectPath(path);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      <div className="flex gap-2 items-center px-3 py-1.5 border-b border-zinc-800 bg-canvas text-xs">
        <span className="font-semibold text-accent">MindAgentGraph</span>
        <span className="text-zinc-600">|</span>
        <button className="hover:text-accent" onClick={onOpen}>Open</button>
        <button className="hover:text-accent" onClick={onSave}>Save As</button>
        <span className="ml-auto text-zinc-500">
          {projectPath ?? "untitled"}
        </span>
        <button
          className="ml-2 text-zinc-400 hover:text-accent text-base leading-none"
          onClick={() => setSettingsOpen(true)}
          title="Settings"
          aria-label="Settings"
        >
          ⚙
        </button>
      </div>
      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
}
