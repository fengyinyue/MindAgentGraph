import { useState } from "react";
import { useGraphStore } from "@/store/graphStore";
import { usePanelStore } from "@/store/panelStore";
import { openProjectDialog, saveProjectDialog } from "@/api/project";
import { useRunNode } from "@/hooks/useRunNode";
import type { NodeBase } from "@shared/types";
import SettingsPanel from "./SettingsPanel";

export default function Toolbar() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const setGraph = useGraphStore((s) => s.setGraph);
  const setProjectPath = useGraphStore((s) => s.setProjectPath);
  const projectPath = useGraphStore((s) => s.projectPath);
  const projectDir = useGraphStore((s) => s.projectDir);
  const setProjectDir = useGraphStore((s) => s.setProjectDir);
  const nodes = useGraphStore((s) => s.nodes);
  const links = useGraphStore((s) => s.links);
  const { runDag, runningId } = useRunNode();
  const toggleLeftPanel = usePanelStore((s) => s.toggleLeft);
  const toggleBottomPanel = usePanelStore((s) => s.toggleBottom);
  const leftOpen = usePanelStore((s) => s.leftOpen);
  const bottomOpen = usePanelStore((s) => s.bottomOpen);

  const onOpen = async () => {
    try {
      const payload = await openProjectDialog();
      if (!payload) return;
      setGraph(payload.graph);
      setProjectPath(payload.path ?? null);
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

  const onSelectProjectDir = async () => {
    try {
      const isTauri = "__TAURI_INTERNALS__" in window;
      if (isTauri) {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const dir = await open({ directory: true, multiple: false, title: "Select project directory for code generation" });
        if (dir && typeof dir === "string") setProjectDir(dir);
        return;
      }
      // Browser mode: no native dialog with full path → prompt.
      const path = prompt("请输入工程目录的完整路径（代码将生成到此目录下）：", projectDir ?? "E:/projects/my-game");
      if (path && path.trim()) setProjectDir(path.trim());
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
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
        <span className="text-zinc-600">|</span>
        <button
          className="hover:text-green-400 font-bold"
          title="Add Node"
          onClick={() => {
            useGraphStore.getState().addNode({
              id: crypto.randomUUID(),
              type: "prompt",
              title: "Prompt",
              position: { x: 250, y: 250 },
              contextMode: "inherit",
              fileScope: { allow: [], deny: [] },
              toolPolicy: { tools: [], deny: [] },
              data: {},
            } as NodeBase);
          }}
        >
          + Node
        </button>
        <button
          className="hover:text-accent disabled:opacity-50"
          onClick={() => void runDag().catch((e) => alert(e instanceof Error ? e.message : String(e)))}
          disabled={runningId !== null || nodes.length === 0}
          title="按拓扑顺序执行整张 DAG"
        >
          Run DAG
        </button>
        <span className="text-zinc-600">|</span>
        <button
          className="hover:text-accent text-xs"
          onClick={onSelectProjectDir}
          title="Project directory for code generation"
        >
          📁 {projectDir ? projectDir.split(/[/\\]/).pop() : "Project Dir"}
        </button>
        <span className="ml-auto text-zinc-500">
          {projectPath ?? "untitled"}
        </span>
        <span className="text-zinc-600">|</span>
        <button
          className={`text-xs ${leftOpen ? "text-accent" : "text-zinc-500"} hover:text-accent`}
          onClick={toggleLeftPanel}
          title={leftOpen ? "折叠左侧面板" : "展开左侧面板"}
        >
          ☰
        </button>
        <button
          className={`text-xs ${bottomOpen ? "text-accent" : "text-zinc-500"} hover:text-accent`}
          onClick={toggleBottomPanel}
          title={bottomOpen ? "折叠底部面板" : "展开底部面板"}
        >
          ⬡
        </button>
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
