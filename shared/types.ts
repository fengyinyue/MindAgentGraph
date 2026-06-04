export type NodeType =
  | "prompt"
  | "planning"
  | "subgraph"
  | "memory"
  | "filescope"
  | "analysis"
  | "code"
  | "api"
  | "asset"
  | "agent"
  | "task"
  | "semantic";

export const NODE_TYPES: NodeType[] = [
  "prompt", "planning", "subgraph", "memory", "filescope",
  "analysis", "code", "api", "asset", "agent", "task", "semantic",
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

export interface ToolTraceItem {
  id: string;
  step: number;
  tool: "list_files" | "read_file" | "grep" | "apply_patch" | "get_diff" | "finish";
  status: "running" | "done" | "error";
  startedAt: string;
  finishedAt?: string;
  input: Record<string, unknown>;
  outputSummary?: string;
  error?: string;
  affectedFiles?: string[];
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
  toolTrace?: ToolTraceItem[];
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
