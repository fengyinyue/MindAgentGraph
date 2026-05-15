import { useEffect, useState, Component } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { Panel, Group, Separator } from "react-resizable-panels";
import Canvas from "./components/Canvas";
import PlanInput from "./components/PlanInput";
import NodeInspector from "./components/NodeInspector";
import Toolbar from "./components/Toolbar";
import LeftPanel from "./components/LeftPanel";
import BottomPanel from "./components/BottomPanel";
import { checkHealth } from "./api/backend";

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
    <div className="h-full">
      <Group orientation="horizontal">
        <Panel defaultSize={25} minSize={3.5} maxSize={30}>
          <LeftPanel />
        </Panel>

        <Separator className="w-1 bg-zinc-800 hover:bg-accent/60 active:bg-accent transition-colors cursor-col-resize" />

        <Panel>
          <Group orientation="vertical">
            <Panel defaultSize={100} minSize={50}>
              <div className="h-full flex flex-col">
                <Toolbar />
                <PlanInput />
                <div className="flex-1 bg-canvas relative">
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

            <Panel defaultSize={0} minSize={0} maxSize={35}>
              <BottomPanel />
            </Panel>
          </Group>
        </Panel>

        <Separator className="w-1 bg-zinc-800 hover:bg-accent/60 active:bg-accent transition-colors cursor-col-resize" />

        <Panel defaultSize={30} minSize={18} maxSize={40}>
          <div className="bg-panel border-l border-zinc-800 overflow-hidden h-full">
            <ErrorBoundary>
              <NodeInspector />
            </ErrorBoundary>
          </div>
        </Panel>
      </Group>
    </div>
  );
}
