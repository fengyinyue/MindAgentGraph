import { useEffect, useState, Component } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { Panel, Group, Separator } from "react-resizable-panels";
import Canvas from "./components/Canvas";
import PlanInput from "./components/PlanInput";
import Toolbar from "./components/Toolbar";
import LeftPanel from "./components/LeftPanel";
import BottomPanel from "./components/BottomPanel";
import OutputViewer from "./components/OutputViewer";
import RightPanel from "./components/RightPanel";
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
    <div className="h-full w-full overflow-hidden flex flex-col">
      <Toolbar />
      <div className="flex-1 min-h-0">
        <Group orientation="horizontal" className="h-full w-full">
          {leftOpen && (
            <>
              <Panel
                key="left-open"
                defaultSize="280px"
                minSize="220px"
                maxSize="520px"
                groupResizeBehavior="preserve-pixel-size"
              >
                <LeftPanel />
              </Panel>
              <Separator className="mag-resize-handle w-1.5 cursor-col-resize" />
            </>
          )}

          <Panel minSize="480px">
            <Group orientation="vertical" className="h-full w-full">
              <Panel minSize="360px">
                <div className="h-full flex flex-col">
                  <PlanInput />
                  <div className="flex-1 min-h-0 bg-canvas relative">
                    {!backendReady && (
                      <div className="mag-list-item absolute top-2 left-2 z-10 px-3 py-1.5 text-xs text-amber-200">
                        等待后端启动…
                      </div>
                    )}
                    <ReactFlowProvider>
                      <Canvas />
                    </ReactFlowProvider>
                  </div>
                </div>
              </Panel>

              {bottomOpen && (
                <>
                  <Separator className="mag-resize-handle h-1 cursor-row-resize" />
                  <Panel
                    key="bottom-open"
                    defaultSize="220px"
                    minSize="140px"
                    maxSize="45%"
                    groupResizeBehavior="preserve-pixel-size"
                  >
                    <BottomPanel />
                  </Panel>
                </>
              )}
            </Group>
          </Panel>

          {rightOpen && (
            <>
              <Separator className="mag-resize-handle w-1.5 cursor-col-resize" />
              <Panel
                key="right-open"
                defaultSize="400px"
                minSize="360px"
                maxSize="720px"
                groupResizeBehavior="preserve-pixel-size"
              >
                <ErrorBoundary>
                  <RightPanel />
                </ErrorBoundary>
              </Panel>
            </>
          )}
        </Group>
      </div>
      <OutputViewer />
    </div>
  );
}
