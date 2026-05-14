export type NodeType =
  | "prompt"
  | "planning"
  | "memory"
  | "filescope"
  | "code"
  | "api"
  | "asset"
  | "agent"
  | "task"
  | "semantic";

export const NODE_TYPES: NodeType[] = [
  "prompt", "planning", "memory", "filescope",
  "code", "api", "asset", "agent", "task", "semantic",
];

export type ContextMode = "inherit" | "explicit" | "isolated";

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
  data: Record<string, unknown>;
  summary?: string;
}

export interface Edge {
  id: string;
  source: string;
  sourceHandle?: string;
  target: string;
  targetHandle?: string;
  channel?: {
    from: string;
    to: string;
  };
}

export interface Graph {
  nodes: NodeBase[];
  links: Edge[];
}

export interface ProjectMeta {
  name: string;
  version: string;
  rootGraph: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}
