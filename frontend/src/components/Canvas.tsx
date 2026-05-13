import { useMemo, useCallback, useState, useEffect } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Node as RFNode,
  type Edge as RFEdge,
  type Connection,
  type NodeChange,
  type EdgeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useGraphStore } from "@/store/graphStore";
import { useRunNode } from "@/hooks/useRunNode";
import { NODE_TYPES, type NodeBase, type NodeType, type Edge as EdgeT } from "@shared/types";

const typeColor: Record<string, string> = {
  prompt: "#6c8eef",
  planning: "#9b6cef",
  memory: "#ef9b6c",
  filescope: "#6cefb6",
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

function nodeToRf(n: NodeBase): RFNode {
  return {
    id: n.id,
    position: n.position,
    type: undefined,
    data: { label: `${n.title}\n[${n.type}]` },
  };
}

function edgeToRf(e: EdgeT): RFEdge {
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle ?? undefined,
    targetHandle: e.targetHandle ?? undefined,
  };
}

export default function Canvas() {
  const storeNodes = useGraphStore((s) => s.nodes);
  const storeEdges = useGraphStore((s) => s.links);
  const selectNode = useGraphStore((s) => s.selectNode);
  const storeRemoveNode = useGraphStore((s) => s.removeNode);

  // xyflow managed state
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<RFNode>(
    storeNodes.map(nodeToRf),
  );
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<RFEdge>(
    storeEdges.map(edgeToRf),
  );

  // Sync Zustand → xyflow when store changes externally (e.g. setGraph).
  // We track last store revision to avoid feeding back xyflow → store → xyflow.
  useEffect(() => {
    setRfNodes(storeNodes.map(nodeToRf));
  }, [storeNodes, setRfNodes]);

  useEffect(() => {
    setRfEdges(storeEdges.map(edgeToRf));
  }, [storeEdges, setRfEdges]);

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
      const newEdge: EdgeT = {
        id: crypto.randomUUID(),
        source: conn.source,
        target: conn.target,
        sourceHandle: conn.sourceHandle ?? undefined,
        targetHandle: conn.targetHandle ?? undefined,
      };
      const state = useGraphStore.getState();
      state.setGraph({ nodes: state.nodes, links: [...state.links, newEdge] });
    },
    [],
  );

  const [menu, setMenu] = useState<ContextMenu | null>(null);
  const [paneMenu, setPaneMenu] = useState<{ x: number; y: number } | null>(null);
  const { run, runCode, runningId } = useRunNode();
  const projectDir = useGraphStore((s) => s.projectDir);
  const { screenToFlowPosition } = useReactFlow();

  const decoratedNodes: RFNode[] = useMemo(
    () =>
      rfNodes.map((n) => {
        const orig = storeNodes.find((s) => s.id === n.id);
        return {
          ...n,
          data: {
            ...n.data,
            label: `${orig?.title ?? n.id}\n[${orig?.type ?? "?"}]${runningId === n.id ? " ●" : ""}`,
          },
          style: {
            borderLeft: `3px solid ${typeColor[orig?.type ?? "semantic"] || "#999"}`,
            whiteSpace: "pre-line" as const,
            opacity: runningId && runningId !== n.id ? 0.6 : 1,
          },
        };
      }),
    [rfNodes, storeNodes, runningId],
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
      const newNode: NodeBase = {
        id: crypto.randomUUID(),
        type,
        title: type.charAt(0).toUpperCase() + type.slice(1),
        position,
        contextMode: "inherit",
        fileScope: { allow: [], deny: [] },
        toolPolicy: { tools: [], deny: [] },
        data: {},
      };
      useGraphStore.getState().addNode(newNode);
    },
    [],
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
        edges={rfEdges}
        onNodesChange={onNodesChangeAndSync}
        onEdgesChange={onEdgesChangeAndSync}
        onConnect={onConnectAndSync}
        onNodeClick={onNodeClick}
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
          <button
            className="block w-full text-left px-3 py-1.5 hover:bg-canvas disabled:opacity-50"
            onClick={() => {
              run(menu.nodeId);
              closeMenu();
            }}
            disabled={runningId !== null}
          >
            ▶ Explain (AI)
          </button>
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
                addNode(nt, pos);
                setPaneMenu(null);
              }}
            >
              + {nt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
