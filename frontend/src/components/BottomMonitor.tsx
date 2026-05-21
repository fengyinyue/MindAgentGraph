import { useMonitorStore } from "@/store/monitorStore";
import type { ReactNode } from "react";

type Tab = "logs" | "errors" | "tokens" | "progress";

interface Props {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
}

const tabs: { key: Tab; label: string }[] = [
  { key: "logs", label: "AI 日志" },
  { key: "errors", label: "错误" },
  { key: "tokens", label: "Token" },
  { key: "progress", label: "进度" },
];

export function BottomMonitorTabs({ activeTab, onTabChange }: Props) {
  return (
    <>
      {tabs.map((t) => (
        <button
          key={t.key}
          className={`px-2 py-0.5 rounded ${
            activeTab === t.key
              ? "bg-accent/20 text-accent"
              : "text-zinc-500 hover:text-zinc-300"
          }`}
          onClick={() => onTabChange(t.key)}
        >
          {t.label}
        </button>
      ))}
    </>
  );
}

export default function BottomMonitor({ activeTab }: { activeTab: Tab }) {
  const logs = useMonitorStore((s) => s.logs);
  const tokenUsages = useMonitorStore((s) => s.tokenUsages);
  const dagProgress = useMonitorStore((s) => s.dagProgress);
  const clearLogs = useMonitorStore((s) => s.clearLogs);
  const clearTokenUsages = useMonitorStore((s) => s.clearTokenUsages);
  const clearDagProgress = useMonitorStore((s) => s.clearDagProgress);
  const errors = logs.filter((l) => l.level === "error");

  return (
    <div className="h-full min-h-0 text-xs">
      {activeTab === "logs" && (
        <MonitorList onClear={clearLogs} empty="暂无日志">
          {logs.map((log) => (
            <div key={log.id} className="grid grid-cols-[76px_58px_70px_88px_1fr] gap-2 px-3 py-1 border-b border-zinc-900/70">
              <span className="text-zinc-600">{new Date(log.timestamp).toLocaleTimeString()}</span>
              <span className={levelClass(log.level)}>{log.level}</span>
              <span className="text-zinc-500">{log.source}</span>
              <span className={statusClass(log.status ?? "")}>{log.status ?? "-"}</span>
              <span className="text-zinc-300 truncate" title={log.message}>
                {log.nodeTitle ? `[${log.nodeTitle}] ` : ""}{log.message}
              </span>
            </div>
          ))}
        </MonitorList>
      )}

      {activeTab === "errors" && (
        <MonitorList onClear={clearLogs} empty="暂无错误">
          {errors.map((log) => (
            <div key={log.id} className="px-3 py-1.5 border-b border-red-950/50 text-red-300">
              <span className="text-red-500 mr-2">{new Date(log.timestamp).toLocaleTimeString()}</span>
              {log.nodeTitle ? `[${log.nodeTitle}] ` : ""}{log.message}
            </div>
          ))}
        </MonitorList>
      )}

      {activeTab === "tokens" && (
        <MonitorList onClear={clearTokenUsages} empty="暂无 Token 使用记录">
          {tokenUsages.map((usage) => (
            <div key={usage.id} className="grid grid-cols-[76px_90px_120px_1fr] gap-2 px-3 py-1 border-b border-zinc-900/70">
              <span className="text-zinc-600">{new Date(usage.timestamp).toLocaleTimeString()}</span>
              <span className="text-zinc-400">{usage.provider ?? "provider"}</span>
              <span className="text-zinc-500 truncate">{usage.model ?? "model unknown"}</span>
              <span className="text-zinc-300">
                in {usage.inputTokens ?? "-"} / out {usage.outputTokens ?? "-"} / total {usage.totalTokens ?? "-"}
              </span>
            </div>
          ))}
        </MonitorList>
      )}

      {activeTab === "progress" && (
        <MonitorList onClear={clearDagProgress} empty="暂无 DAG 执行进度">
          {dagProgress.map((item) => (
            <div key={`${item.runId}:${item.nodeId}`} className="grid grid-cols-[90px_1fr_2fr] gap-2 px-3 py-1 border-b border-zinc-900/70">
              <span className={statusClass(item.status)}>{item.status}</span>
              <span className="text-zinc-300 truncate">{item.nodeTitle ?? item.nodeId}</span>
              <span className="text-zinc-500 truncate">{item.message ?? ""}</span>
            </div>
          ))}
        </MonitorList>
      )}
    </div>
  );
}

function MonitorList({ children, onClear, empty }: { children: ReactNode; onClear: () => void; empty: string }) {
  const hasItems = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <div className="h-full flex flex-col">
      <div className="px-3 py-1 border-b border-zinc-900 flex justify-end">
        <button className="text-zinc-500 hover:text-accent" onClick={onClear}>Clear</button>
      </div>
      <div className="flex-1 overflow-auto">
        {hasItems ? children : <div className="h-full flex items-center justify-center text-zinc-600">{empty}</div>}
      </div>
    </div>
  );
}

function levelClass(level: string): string {
  if (level === "error") return "text-red-400";
  if (level === "warn") return "text-amber-400";
  return "text-zinc-500";
}

function statusClass(status: string): string {
  if (status === "done") return "text-emerald-400";
  if (status === "error") return "text-red-400";
  if (status === "running") return "text-accent animate-pulse";
  if (status === "skipped") return "text-amber-400";
  return "text-zinc-500";
}
