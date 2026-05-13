import { useEffect, useState, Component } from "react";
import Canvas from "./components/Canvas";
import PlanInput from "./components/PlanInput";
import NodeInspector from "./components/NodeInspector";
import Toolbar from "./components/Toolbar";
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
    <div className="h-full grid grid-rows-[auto_auto_1fr] grid-cols-[1fr_320px]">
      <div className="col-span-2">
        <Toolbar />
      </div>
      <div className="col-span-2">
        <PlanInput />
      </div>
      <div className="bg-canvas relative">
        {!backendReady && (
          <div className="absolute top-2 left-2 z-10 bg-yellow-900/80 text-yellow-200 text-xs px-3 py-1.5 rounded">
            等待后端启动…
          </div>
        )}
        <Canvas />
      </div>
      <div className="bg-panel border-l border-zinc-800 overflow-hidden">
        <ErrorBoundary>
          <NodeInspector />
        </ErrorBoundary>
      </div>
    </div>
  );
}
