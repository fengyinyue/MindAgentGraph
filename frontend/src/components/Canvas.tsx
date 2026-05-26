import { useMemo, useCallback, useState, useEffect } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  MiniMap,
  Position as FlowPosition,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Node as RFNode,
  type Edge as RFEdge,
  type Connection,
  type NodeChange,
  type EdgeChange,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useGraphStore } from "@/store/graphStore";
import { useRunNode } from "@/hooks/useRunNode";
import { useOutputPanelStore } from "@/store/outputPanelStore";
import { NODE_TYPES, type DataPort, type DataPortType, type NodeBase, type NodeType, type Edge as EdgeT } from "@shared/types";

const typeColor: Record<string, string> = {
  prompt: "#6c8eef",
  planning: "#9b6cef",
  workflow_graph: "#9b6cef",
  structure_graph: "#14b8a6",
  memory: "#ef9b6c",
  filescope: "#6cefb6",
  project_scan: "#38bdf8",
  code_analysis: "#22d3ee",
  code: "#ef6c8e",
  api: "#efef6c",
  asset: "#ef6cef",
  agent: "#6cefef",
  task: "#bcef6c",
  semantic: "#a0a0a0",
};

interface ContextMenu {
  x: number;
  y: number;
  nodeId: string;
}

interface MagNodeData extends Record<string, unknown> {
  node: NodeBase;
  running: boolean;
  needsConfirmation: boolean;
}

interface MagEdgeData extends Record<string, unknown> {
  labelText?: string;
}

function nodeToRf(n: NodeBase): RFNode {
  return {
    id: n.id,
    position: n.position,
    type: "magNode",
    data: {
      node: n,
      running: false,
      needsConfirmation: false,
    } satisfies MagNodeData,
  };
}

function edgeToRf(e: EdgeT): RFEdge {
  const labelText = e.label ?? (e.channel ? `${e.channel.from} -> ${e.channel.to}` : undefined);
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle ?? undefined,
    targetHandle: e.targetHandle ?? undefined,
    data: { labelText } satisfies MagEdgeData,
    style: labelText ? { strokeWidth: 1.8 } : undefined,
  };
}

function normalizePorts(value: unknown, fallbackPrefix: "input" | "output"): DataPort[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw, index): DataPort[] => {
    if (typeof raw === "string") {
      return [{ id: `${fallbackPrefix}_${index}`, name: raw, type: "unknown" }];
    }
    if (!raw || typeof raw !== "object") return [];
    const candidate = raw as Partial<DataPort>;
    const name = typeof candidate.name === "string" ? candidate.name : typeof candidate.id === "string" ? candidate.id : `${fallbackPrefix} ${index + 1}`;
    return [{
      id: typeof candidate.id === "string" ? candidate.id : name.toLowerCase().replace(/\s+/g, "_"),
      name,
      type: isDataPortType(candidate.type) ? candidate.type : "unknown",
    }];
  });
}

const defaultPortsByType: Record<NodeType, { inputs: DataPort[]; outputs: DataPort[] }> = {
  prompt: {
    inputs: [{ id: "context", name: "Context", type: "unknown" }],
    outputs: [{ id: "response", name: "Response", type: "unknown" }],
  },
  planning: {
    inputs: [{ id: "context", name: "Context", type: "unknown" }],
    outputs: [{ id: "plan", name: "Plan", type: "unknown" }],
  },
  workflow_graph: {
    inputs: [{ id: "context", name: "Context", type: "unknown" }],
    outputs: [{ id: "plan", name: "Plan", type: "unknown" }],
  },
  structure_graph: {
    inputs: [{ id: "context", name: "Context", type: "unknown" }],
    outputs: [{ id: "structure", name: "Structure", type: "graph" }],
  },
  memory: {
    inputs: [{ id: "context", name: "Context", type: "unknown" }],
    outputs: [{ id: "memory", name: "Memory", type: "unknown" }],
  },
  filescope: {
    inputs: [{ id: "context", name: "Context", type: "unknown" }],
    outputs: [{ id: "file_scope", name: "File Scope", type: "unknown" }],
  },
  project_scan: {
    inputs: [{ id: "project", name: "Project", type: "unknown" }],
    outputs: [{ id: "scan", name: "Scan", type: "unknown" }],
  },
  code_analysis: {
    inputs: [{ id: "project", name: "Project", type: "unknown" }],
    outputs: [{ id: "analysis", name: "Analysis", type: "unknown" }],
  },
  code: {
    inputs: [{ id: "context", name: "Context", type: "unknown" }],
    outputs: [{ id: "result", name: "Result", type: "unknown" }],
  },
  api: {
    inputs: [{ id: "request", name: "Request", type: "unknown" }],
    outputs: [{ id: "response", name: "Response", type: "unknown" }],
  },
  asset: {
    inputs: [{ id: "context", name: "Context", type: "unknown" }],
    outputs: [{ id: "asset", name: "Asset", type: "asset" }],
  },
  agent: {
    inputs: [{ id: "context", name: "Context", type: "unknown" }],
    outputs: [{ id: "result", name: "Result", type: "unknown" }],
  },
  task: {
    inputs: [{ id: "context", name: "Context", type: "unknown" }],
    outputs: [{ id: "result", name: "Result", type: "unknown" }],
  },
  semantic: {
    inputs: [{ id: "context", name: "Context", type: "unknown" }],
    outputs: [{ id: "result", name: "Result", type: "unknown" }],
  },
};

function nodePorts(node: NodeBase): { inputs: DataPort[]; outputs: DataPort[] } {
  const inputs = normalizePorts(node.data?.inputs, "input");
  const outputs = normalizePorts(node.data?.outputs, "output");
  if (inputs.length || outputs.length) {
    return { inputs, outputs };
  }
  return defaultPortsByType[node.type] ?? defaultPortsByType.task;
}

function isDataPortType(value: unknown): value is DataPortType {
  return typeof value === "string" && value in portColor;
}

function nodeTypeLabel(type: NodeType): string {
  if (type === "planning" || type === "workflow_graph") return "Workflow Graph";
  if (type === "structure_graph") return "Structure Graph";
  if (type === "project_scan") return "Project Scan";
  if (type === "code_analysis") return "Code Analysis";
  return type.charAt(0).toUpperCase() + type.slice(1);
}

const portColor: Record<DataPortType, string> = {
  spline: "#22d3ee",
  point: "#22c55e",
  polygon: "#f59e0b",
  bounds: "#a78bfa",
  graph: "#60a5fa",
  debug: "#f472b6",
  asset: "#e879f9",
  unknown: "#94a3b8",
};

function findOutputPort(nodes: NodeBase[], nodeId?: string | null, handleId?: string | null): DataPort | undefined {
  if (!nodeId || !handleId) return undefined;
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return undefined;
  return nodePorts(node).outputs.find((port) => port.id === handleId);
}

function MagGraphNode({ data, selected }: NodeProps<RFNode<MagNodeData>>) {
  const node = data.node;
  const { inputs, outputs } = nodePorts(node);
  const minRows = Math.max(inputs.length, outputs.length, 1);

  return (
    <div
      className="mag-node"
      style={{
        borderTopColor: data.needsConfirmation ? "#f59e0b" : typeColor[node.type] || "#999",
        opacity: data.running ? 1 : undefined,
        boxShadow: selected ? "0 0 0 1px #6c8eef" : undefined,
      }}
    >
      <div className="mag-node-title">
        <span className="truncate">{node.title}</span>
        <span className="mag-node-type">[{node.type}]{data.running ? " ●" : data.needsConfirmation ? " ?" : ""}</span>
      </div>
      <div
        className="mag-node-ports"
        style={{
          minHeight: Math.max(34, minRows * 24),
          gridTemplateRows: `repeat(${minRows}, 24px)`,
        }}
      >
        <div className="mag-node-port-list">
          {inputs.map((port, index) => (
            <div key={port.id} className="mag-node-port-row mag-node-port-row-in" style={{ gridRow: index + 1 }}>
              <Handle
                id={port.id}
                type="target"
                position={FlowPosition.Left}
                className="mag-node-handle"
                style={{ background: portColor[port.type], borderColor: portColor[port.type] }}
              />
              <span className="mag-node-port-name" title={`${port.name} (${port.type})`}>{port.name}</span>
            </div>
          ))}
        </div>
        <div className="mag-node-port-list">
          {outputs.map((port, index) => (
            <div key={port.id} className="mag-node-port-row mag-node-port-row-out" style={{ gridRow: index + 1 }}>
              <span className="mag-node-port-name text-right" title={`${port.name} (${port.type})`}>{port.name}</span>
              <Handle
                id={port.id}
                type="source"
                position={FlowPosition.Right}
                className="mag-node-handle"
                style={{ background: portColor[port.type], borderColor: portColor[port.type] }}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Canvas() {
  const storeNodes = useGraphStore((s) => s.nodes);
  const storeEdges = useGraphStore((s) => s.links);
  const activeParentId = useGraphStore((s) => s.activeParentId);
  const selectNode = useGraphStore((s) => s.selectNode);
  const storeRemoveNode = useGraphStore((s) => s.removeNode);
  const enterSubgraph = useGraphStore((s) => s.enterSubgraph);
  const exitSubgraph = useGraphStore((s) => s.exitSubgraph);
  const visibleNodes = useMemo(
    () => storeNodes.filter((node) => (node.parentId ?? null) === activeParentId),
    [storeNodes, activeParentId],
  );
  const visibleNodeIds = useMemo(() => new Set(visibleNodes.map((node) => node.id)), [visibleNodes]);
  const visibleEdges = useMemo(
    () => storeEdges.filter((edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)),
    [storeEdges, visibleNodeIds],
  );
  const activeParentNode = activeParentId ? storeNodes.find((node) => node.id === activeParentId) : undefined;

  // xyflow managed state
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<RFNode>(
    visibleNodes.map(nodeToRf),
  );
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<RFEdge>(
    visibleEdges.map(edgeToRf),
  );

  // Sync Zustand → xyflow when store changes externally (e.g. setGraph).
  // We track last store revision to avoid feeding back xyflow → store → xyflow.
  useEffect(() => {
    setRfNodes(visibleNodes.map(nodeToRf));
  }, [visibleNodes, setRfNodes]);

  useEffect(() => {
    setRfEdges(visibleEdges.map(edgeToRf));
  }, [visibleEdges, setRfEdges]);

  // Sync xyflow → Zustand (positions only, on drag end).
  const onNodesChangeAndSync = useCallback(
    (changes: NodeChange[]) => {
      // Detect position changes (drag end) → persist to Zustand.
      for (const c of changes) {
        if (c.type === "position" && c.position && c.dragging === false) {
          const storeNode = storeNodes.find((n) => n.id === c.id);
          if (storeNode) {
            useGraphStore.getState().updateNode(c.id, {
              position: {
                x: Math.round(c.position.x * 10) / 10,
                y: Math.round(c.position.y * 10) / 10,
              },
            });
          }
        } else if (c.type === "remove") {
          storeRemoveNode(c.id);
        }
      }
      onNodesChange(changes);
    },
    [onNodesChange, storeNodes, storeRemoveNode],
  );

  const onEdgesChangeAndSync = useCallback(
    (changes: EdgeChange[]) => {
      for (const c of changes) {
        if (c.type === "remove") {
          // Also remove from Zustand
          const state = useGraphStore.getState();
          state.setGraph({
            nodes: state.nodes,
            links: state.links.filter((e) => e.id !== c.id),
          });
        }
      }
      onEdgesChange(changes);
    },
    [onEdgesChange],
  );

  const onConnectAndSync = useCallback(
    (conn: Connection) => {
      const sourcePort = findOutputPort(storeNodes, conn.source, conn.sourceHandle);
      const newEdge: EdgeT = {
        id: crypto.randomUUID(),
        source: conn.source,
        target: conn.target,
        sourceHandle: conn.sourceHandle ?? undefined,
        targetHandle: conn.targetHandle ?? undefined,
        label: sourcePort?.name,
      };
      const state = useGraphStore.getState();
      state.setGraph({ nodes: state.nodes, links: [...state.links, newEdge] });
    },
    [storeNodes],
  );

  const [menu, setMenu] = useState<ContextMenu | null>(null);
  const [paneMenu, setPaneMenu] = useState<{ x: number; y: number } | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const { run, runCode, runDag, expandPlanNodes, expandModuleGraph, runningId } = useRunNode();
  const openOutputPanel = useOutputPanelStore((s) => s.open);
  const projectDir = useGraphStore((s) => s.projectDir);
  const { screenToFlowPosition } = useReactFlow();
  const nodeTypes = useMemo(() => ({ magNode: MagGraphNode }), []);
  const contextMenuNode = menu
    ? storeNodes.find((node) => node.id === menu.nodeId)
    : undefined;
  const contextMenuOutput = contextMenuNode
    ? contextMenuNode.output ?? (contextMenuNode.data?.output as string | undefined) ?? ""
    : "";
  const contextMenuCodeOutput = contextMenuNode
    ? (contextMenuNode.data?.codeOutput as string | undefined) ?? ""
    : "";
  const contextMenuCanExplain = contextMenuNode !== undefined;
  const contextMenuIsProjectScan = contextMenuNode?.type === "project_scan";
  const contextMenuIsCodeAnalysis = contextMenuNode?.type === "code_analysis";
  const contextMenuCanGenerateNodes = (contextMenuNode?.type === "workflow_graph" || contextMenuNode?.type === "structure_graph" || contextMenuNode?.type === "planning") && contextMenuOutput;
  const contextMenuCanEnter = contextMenuNode?.type === "structure_graph";
  const contextMenuCanGenerateModuleGraph = contextMenuNode?.type === "code_analysis" && contextMenuOutput;
  const contextMenuHasDownstream = contextMenuNode ? storeEdges.some((e) => e.source === contextMenuNode.id) : false;

  const decoratedNodes: RFNode[] = useMemo(
    () =>
      rfNodes.map((n) => {
        const orig = storeNodes.find((s) => s.id === n.id);
        const status = orig?.data?.status;
        return {
          ...n,
          data: {
            ...n.data,
            node: orig ?? (n.data as MagNodeData).node,
            running: runningId === n.id,
            needsConfirmation: status === "needs_confirmation",
          },
          style: {
            opacity: runningId && runningId !== n.id ? 0.6 : 1,
          },
        };
      }),
    [rfNodes, storeNodes, runningId],
  );

  const decoratedEdges: RFEdge[] = useMemo(
    () =>
      rfEdges.map((edge) => {
        const labelText = (edge.data as MagEdgeData | undefined)?.labelText;
        const showLabel = Boolean(labelText && (edge.selected || edge.id === hoveredEdgeId));
        return {
          ...edge,
          label: showLabel ? labelText : undefined,
          labelStyle: showLabel ? { fill: "#cbd5e1", fontSize: 11 } : undefined,
          labelBgStyle: showLabel ? { fill: "#111827", fillOpacity: 0.85 } : undefined,
        };
      }),
    [rfEdges, hoveredEdgeId],
  );

  const onNodeClick = useCallback(
    (_: unknown, node: RFNode) => {
      selectNode(node.id);
      setMenu(null);
    },
    [selectNode],
  );

  const onNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: RFNode) => {
      event.preventDefault();
      selectNode(node.id);
      setMenu({ x: event.clientX, y: event.clientY, nodeId: node.id });
    },
    [selectNode],
  );

  const closeMenu = useCallback(() => setMenu(null), []);

  const addNode = useCallback(
    (type: NodeType, position: { x: number; y: number }) => {
      const id = crypto.randomUUID();
      const newNode: NodeBase = {
        id,
        type,
        title: nodeTypeLabel(type),
        position,
        contextMode: type === "project_scan" ? "isolated" : "inherit",
        fileScope: { allow: [], deny: [] },
        toolPolicy: { tools: [], deny: [] },
        memoryRef: type === "memory" ? `${id}.md` : undefined,
        parentId: activeParentId ?? undefined,
        data: {},
        runHistory: [],
        resourceRefs: [],
        metadata: {},
      };
      useGraphStore.getState().addNode(newNode);
    },
    [activeParentId],
  );

  // Keyboard shortcut "N": add a prompt node at viewport center.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        const center = screenToFlowPosition({
          x: window.innerWidth / 2,
          y: window.innerHeight / 2,
        });
        addNode("prompt", center);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [addNode, screenToFlowPosition]);

  return (
    <div className="w-full h-full" onClick={() => { closeMenu(); setPaneMenu(null); }}>
      <ReactFlow
        nodes={decoratedNodes}
        edges={decoratedEdges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChangeAndSync}
        onEdgesChange={onEdgesChangeAndSync}
        onConnect={onConnectAndSync}
        onEdgeMouseEnter={(_, edge) => setHoveredEdgeId(edge.id)}
        onEdgeMouseLeave={() => setHoveredEdgeId(null)}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={(_, node) => {
          const graphNode = storeNodes.find((item) => item.id === node.id);
          if (graphNode?.type === "structure_graph") enterSubgraph(graphNode.id);
        }}
        onNodeContextMenu={onNodeContextMenu}
        onPaneContextMenu={(e) => {
          e.preventDefault();
          closeMenu();
          setPaneMenu({ x: e.clientX, y: e.clientY });
        }}
        deleteKeyCode={["Backspace", "Delete"]}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        {activeParentNode ? (
          <div className="absolute left-3 top-3 z-10 flex items-center gap-2 rounded border border-zinc-700 bg-panel/95 px-2 py-1 text-xs shadow-xl">
            <button
              className="rounded border border-zinc-700 px-2 py-0.5 text-zinc-300 hover:border-accent hover:text-accent"
              onClick={(e) => {
                e.stopPropagation();
                exitSubgraph();
              }}
            >
              Back
            </button>
            <span className="text-zinc-500">Inside</span>
            <span className="max-w-64 truncate text-zinc-200">{activeParentNode.title}</span>
          </div>
        ) : null}
        <Background color="#1f2330" gap={20} />
        <Controls className="!bg-panel !border-none" />
        <MiniMap
          className="!bg-panel"
          nodeColor={(n) => {
            const orig = storeNodes.find((x) => x.id === n.id);
            return orig ? typeColor[orig.type] || "#666" : "#666";
          }}
        />
      </ReactFlow>

      {menu && (
        <div
          className="fixed bg-panel border border-zinc-700 rounded shadow-2xl text-xs py-1 z-50 min-w-[140px]"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenuCanExplain ? (
            <button
              className="block w-full text-left px-3 py-1.5 hover:bg-canvas disabled:opacity-50"
              onClick={() => {
                run(menu.nodeId);
                closeMenu();
              }}
              disabled={runningId !== null || ((contextMenuIsProjectScan || contextMenuIsCodeAnalysis) && !projectDir)}
              title={(contextMenuIsProjectScan || contextMenuIsCodeAnalysis) && !projectDir ? "请先在工具栏选择 Project Dir" : undefined}
            >
              {contextMenuIsProjectScan ? "⌕ Scan Project" : contextMenuIsCodeAnalysis ? "◇ Analyze Code" : "▶ Explain (AI)"}
            </button>
          ) : null}
          {contextMenuCanGenerateNodes ? (
            <button
              className="block w-full text-left px-3 py-1.5 hover:bg-canvas disabled:opacity-50"
              onClick={() => {
                expandPlanNodes(menu.nodeId);
                closeMenu();
              }}
              disabled={runningId !== null}
            >
              ✦ Generate Nodes
            </button>
          ) : null}
          {contextMenuCanEnter ? (
            <button
              className="block w-full text-left px-3 py-1.5 hover:bg-canvas disabled:opacity-50"
              onClick={() => {
                enterSubgraph(menu.nodeId);
                closeMenu();
              }}
            >
              Enter Subgraph
            </button>
          ) : null}
          {contextMenuCanGenerateModuleGraph ? (
            <button
              className="block w-full text-left px-3 py-1.5 hover:bg-canvas disabled:opacity-50"
              onClick={() => {
                expandModuleGraph(menu.nodeId);
                closeMenu();
              }}
              disabled={runningId !== null}
            >
              ⬡ Generate Module Graph
            </button>
          ) : null}
          {contextMenuHasDownstream ? (
            <button
              className="block w-full text-left px-3 py-1.5 hover:bg-canvas disabled:opacity-50"
              onClick={() => {
                runDag(menu.nodeId);
                closeMenu();
              }}
              disabled={runningId !== null}
            >
              ▶ Execute Subtree
            </button>
          ) : null}
          {contextMenuNode?.type === "code" ? (
            <button
              className="block w-full text-left px-3 py-1.5 hover:bg-canvas disabled:opacity-50"
              onClick={() => {
                runCode(menu.nodeId);
                closeMenu();
              }}
              disabled={runningId !== null || !projectDir}
              title={!projectDir ? "请先在工具栏点 📁 选择工程目录" : undefined}
            >
              ⚡ Generate Code
            </button>
          ) : null}
          {contextMenuOutput ? (
            <button
              className="block w-full text-left px-3 py-1.5 hover:bg-canvas"
              onClick={() => {
                openOutputPanel(menu.nodeId, "explain");
                closeMenu();
              }}
            >
              View Explain Output
            </button>
          ) : null}
          {contextMenuCodeOutput ? (
            <button
              className="block w-full text-left px-3 py-1.5 hover:bg-canvas"
              onClick={() => {
                openOutputPanel(menu.nodeId, "code");
                closeMenu();
              }}
            >
              View Code Output
            </button>
          ) : null}
          <hr className="border-zinc-700 my-1" />
          <button
            className="block w-full text-left px-3 py-1.5 hover:bg-canvas hover:text-red-400"
            onClick={() => {
              storeRemoveNode(menu.nodeId);
              closeMenu();
            }}
          >
            🗑 Delete
          </button>
        </div>
      )}

      {paneMenu && (
        <div
          className="fixed bg-panel border border-zinc-700 rounded shadow-2xl text-xs py-1 z-50 min-w-[140px]"
          style={{ left: paneMenu.x, top: paneMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-1 text-zinc-500 uppercase tracking-wider text-[10px]">
            Add Node
          </div>
          <hr className="border-zinc-700 my-0.5" />
          {NODE_TYPES.map((nt) => (
            <button
              key={nt}
              className="block w-full text-left px-3 py-1 hover:bg-canvas"
              onClick={() => {
                const pos = screenToFlowPosition({ x: paneMenu.x, y: paneMenu.y });
                addNode(nt === "planning" ? "workflow_graph" : nt, pos);
                setPaneMenu(null);
              }}
            >
              + {nodeTypeLabel(nt)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
