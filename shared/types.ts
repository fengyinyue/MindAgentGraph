export type NodeType =
  | "prompt"
  | "planning"
  | "workflow_graph"
  | "structure_graph"
  | "memory"
  | "filescope"
  | "project_scan"
  | "code_analysis"
  | "code"
  | "api"
  | "asset"
  | "agent"
  | "task"
  | "semantic";

export const NODE_TYPES: NodeType[] = [
  "prompt", "workflow_graph", "structure_graph", "memory", "filescope",
  "project_scan", "code_analysis", "code", "api", "asset", "agent", "task", "semantic",
];

export type ContextMode = "inherit" | "explicit" | "isolated";

export type DataPortType =
  | "spline"
  | "point"
  | "polygon"
  | "bounds"
  | "graph"
  | "debug"
  | "asset"
  | "unknown";

export interface DataPort {
  id: string;
  name: string;
  type: DataPortType;
}

export interface Position {
  x: number;
  y: number;
}

export interface FileScope {
  allow: string[];
  deny: string[];
}

export interface ToolPolicy {
  tools: string[];
  deny: string[];
}

export interface RunRecord {
  id: string;
  startedAt: string;
  finishedAt?: string;
  status: "running" | "done" | "error" | "cancelled";
  provider?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  error?: string;
  changedFiles?: string[];
  diff?: string;
  diffTruncated?: boolean;
  diffWarnings?: string[];
}

export type CodeRunEventType =
  | "run_started"
  | "prompt_prepared"
  | "mcp_tool_called"
  | "mcp_tool_result"
  | "context_requested"
  | "step_reported"
  | "decision_reported"
  | "confirmation_requested"
  | "confirmation_answered"
  | "stdout"
  | "stderr"
  | "diff_captured"
  | "result_saved"
  | "run_finished"
  | "run_error";

export interface CodeRunEvent {
  id: string;
  runId: string;
  nodeId: string;
  type: CodeRunEventType;
  createdAt: string;
  title: string;
  message?: string;
  path?: string;
  command?: string;
  toolName?: string;
  status?: "pending" | "running" | "done" | "error";
  payload?: unknown;
}

export interface NodeBase {
  id: string;
  type: NodeType;
  title: string;
  position: Position;
  contextMode: ContextMode;
  fileScope: FileScope;
  toolPolicy: ToolPolicy;
  memoryRef?: string;
  systemPrompt?: string;
  parentId?: string;
  data: Record<string, unknown>;
  summary?: string;
  purpose?: string;
  output?: string;
  runHistory?: RunRecord[];
  resourceRefs?: string[];
  metadata?: Record<string, unknown>;
}

export interface Edge {
  id: string;
  source: string;
  sourceHandle?: string;
  target: string;
  targetHandle?: string;
  label?: string;
  channel?: {
    from: string;
    to: string;
  };
}

export interface Graph {
  nodes: NodeBase[];
  links: Edge[];
  metadata?: Record<string, unknown>;
}

export interface ProjectMeta {
  name: string;
  version: string;
  rootGraph: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}
