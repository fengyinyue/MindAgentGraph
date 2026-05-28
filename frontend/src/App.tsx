import { useEffect, useState, Component } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { Panel, Group, Separator } from "react-resizable-panels";
import Canvas from "./components/Canvas";
import PlanInput from "./components/PlanInput";
import ChatBox from "./components/ChatBox";
import Toolbar from "./components/Toolbar";
import LeftPanel from "./components/LeftPanel";
import BottomPanel from "./components/BottomPanel";
import OutputViewer from "./components/OutputViewer";
import { checkHealth } from "./api/backend";
import { usePanelStore } from "./store/panelStore";

// Catch render errors so a crash in one panel doesn't white-screen the entire app.
class ErrorBoundary extends Component<{ children: React.ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: Error) {
    return { error: e.message };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="p-4 text-red-400 text-xs whitespace-pre-wrap">
          <div className="font-bold mb-1">Render Error:</div>
          {this.state.error}
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const [backendReady, setBackendReady] = useState(false);
  const leftOpen = usePanelStore((s) => s.leftOpen);
  const bottomOpen = usePanelStore((s) => s.bottomOpen);
  const rightOpen = usePanelStore((s) => s.rightOpen);

  useEffect(() => {
    let cancelled = false;
    const tryHealth = async () => {
      for (let i = 0; i < 30 && !cancelled; i++) {
        if (await checkHealth()) {
          if (!cancelled) setBackendReady(true);
          return;
        }
        await new Promise((r) => setTimeout(r, 500));
      }
    };
    tryHealth();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="h-full w-full overflow-hidden">
      <Group orientation="horizontal" className="h-full w-full">
        <Panel
          key={`left-${leftOpen ? "open" : "closed"}`}
          defaultSize={leftOpen ? "280px" : "36px"}
          minSize={leftOpen ? "220px" : "36px"}
          maxSize={leftOpen ? "520px" : "36px"}
          disabled={!leftOpen}
          groupResizeBehavior="preserve-pixel-size"
        >
          <LeftPanel />
        </Panel>

        <Separator className="w-1.5 bg-zinc-800 hover:bg-accent/60 active:bg-accent transition-colors cursor-col-resize" />

        <Panel minSize="480px">
          <Group orientation="vertical" className="h-full w-full">
            <Panel minSize="360px">
              <div className="h-full flex flex-col">
                <Toolbar />
                <PlanInput />
                <div className="flex-1 min-h-0 bg-canvas relative">
                  {!backendReady && (
                    <div className="absolute top-2 left-2 z-10 bg-yellow-900/80 text-yellow-200 text-xs px-3 py-1.5 rounded">
                      等待后端启动…
                    </div>
                  )}
                  <ReactFlowProvider>
                    <Canvas />
                  </ReactFlowProvider>
                </div>
              </div>
            </Panel>

            <Separator className="h-1 bg-zinc-800 hover:bg-accent/60 active:bg-accent transition-colors cursor-row-resize" />

            <Panel
              key={`bottom-${bottomOpen ? "open" : "closed"}`}
              defaultSize={bottomOpen ? "220px" : "28px"}
              minSize={bottomOpen ? "140px" : "28px"}
              maxSize={bottomOpen ? "45%" : "28px"}
              disabled={!bottomOpen}
              groupResizeBehavior="preserve-pixel-size"
            >
              <BottomPanel />
            </Panel>
          </Group>
        </Panel>

        <Separator className="w-1.5 bg-zinc-800 hover:bg-accent/60 active:bg-accent transition-colors cursor-col-resize" />

        <Panel
          key={`right-${rightOpen ? "open" : "closed"}`}
          defaultSize={rightOpen ? "360px" : "32px"}
          minSize={rightOpen ? "280px" : "32px"}
          maxSize={rightOpen ? "720px" : "32px"}
          disabled={!rightOpen}
          groupResizeBehavior="preserve-pixel-size"
        >
          <ErrorBoundary>
            <ChatBox />
          </ErrorBoundary>
        </Panel>
      </Group>
      <OutputViewer />
    </div>
  );
}
