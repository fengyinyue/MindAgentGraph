import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { editGraphWithChatStream, type ChatHistoryMessage, type GraphEditResult } from "@/api/backend";
import { useGraphStore } from "@/store/graphStore";
import { useKeyStore } from "@/store/keyStore";
import { usePanelStore } from "@/store/panelStore";
import { useProviderStore } from "@/store/providerStore";
import type { Edge, Graph, NodeBase, NodeType } from "@shared/types";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

type GraphCommandResult = {
  ok: boolean;
  text: string;
};

const typeAliases: Array<{ type: NodeType; words: string[]; label: string }> = [
  { type: "prompt", words: ["requirement", "prompt", "需求", "输入", "提示", "提示词"], label: "Requirement" },
  { type: "planning", words: ["design", "workflow", "planning", "规划", "设计", "流程", "工作流"], label: "Design" },
  { type: "subgraph", words: ["structure", "subgraph", "架构", "结构", "模块图"], label: "Subgraph" },
  { type: "memory", words: ["memory", "记忆", "知识"], label: "Memory" },
  { type: "filescope", words: ["filescope", "file scope", "文件范围"], label: "File Scope" },
  { type: "analysis", words: ["analysis", "analyze", "代码分析"], label: "Analysis" },
  { type: "code", words: ["code", "execution", "执行", "代码"], label: "Execution" },
  { type: "api", words: ["api", "接口"], label: "API" },
  { type: "asset", words: ["asset", "资源", "资产"], label: "Asset" },
  { type: "agent", words: ["agent", "智能体"], label: "Agent" },
  { type: "task", words: ["task", "任务"], label: "Task" },
  { type: "semantic", words: ["semantic", "语义"], label: "Semantic" },
];

const statusAliases: Record<string, string> = {
  planned: "planned",
  plan: "planned",
  todo: "planned",
  待办: "planned",
  计划: "planned",
  in_progress: "in_progress",
  progress: "in_progress",
  doing: "in_progress",
  进行中: "in_progress",
  blocked: "blocked",
  block: "blocked",
  阻塞: "blocked",
  done: "done",
  complete: "done",
  completed: "done",
  完成: "done",
  已完成: "done",
  cancelled: "cancelled",
  canceled: "cancelled",
  取消: "cancelled",
  已取消: "cancelled",
};

function cleanInput(text: string) {
  return text.trim().replace(/\s+/g, " ");
}

function quotedText(text: string) {
  return text.match(/["“”']([^"“”']+)["“”']/)?.[1]?.trim();
}

function detectType(text: string): { type: NodeType; label: string } {
  const lower = text.toLowerCase();
  return (
    typeAliases.find((entry) => entry.words.some((word) => lower.includes(word.toLowerCase()))) ?? {
      type: "task",
      label: "Task",
    }
  );
}

function isNodeType(value: unknown): value is NodeType {
  return typeof value === "string" && typeAliases.some((entry) => entry.type === value);
}

function stripTypeWords(text: string) {
  let result = text;
  for (const entry of typeAliases) {
    for (const word of entry.words) {
      result = result.replace(new RegExp(word.replace(/\s+/g, "\\s+"), "gi"), " ");
    }
  }
  return result;
}

function makeNode(type: NodeType, title: string, position: { x: number; y: number }, parentId: string | null): NodeBase {
  const id = crypto.randomUUID();
  return {
    id,
    type,
    title,
    position,
    contextMode: "inherit",
    fileScope: { allow: [], deny: [] },
    toolPolicy: { tools: [], deny: [] },
    memoryRef: type === "memory" ? `${id}.md` : undefined,
    parentId: parentId ?? undefined,
    data: {},
    runHistory: [],
    resourceRefs: [],
    metadata: { createdBy: "chat" },
  };
}

function splitClauses(text: string) {
  return text
    .split(/[\n;；。]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function findNode(nodes: NodeBase[], rawName: string, parentId: string | null): NodeBase | undefined {
  const name = rawName.trim().replace(/^把\s*/, "").replace(/^节点\s*/, "").replace(/[。.!！?？]$/, "");
  if (!name) return undefined;
  const scoped = nodes.filter((node) => (node.parentId ?? null) === parentId);
  const all = scoped.length ? scoped : nodes;
  const lower = name.toLowerCase();
  return (
    all.find((node) => node.id === name) ??
    all.find((node) => node.title.toLowerCase() === lower) ??
    all.find((node) => node.title.toLowerCase().includes(lower)) ??
    all.find((node) => lower.includes(node.title.toLowerCase()))
  );
}

function extractNodeTitle(text: string, fallback: string) {
  const quoted = quotedText(text);
  if (quoted) return quoted;
  const explicit = text.match(/(?:叫|名为|标题为|title\s+is|named|called)\s*[:：]?\s*(.+)$/i)?.[1];
  if (explicit?.trim()) return explicit.trim();
  const cleaned = stripTypeWords(text)
    .replace(/^(请|帮我|给我|把|在图里|在画布上|创建|新建|添加|建立|add|create|make)\s*/gi, "")
    .replace(/(一个|1个|节点|node)/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || fallback;
}

function parseStatus(text: string) {
  const lower = text.toLowerCase();
  return Object.entries(statusAliases).find(([key]) => lower.includes(key))?.[1];
}

function graphFromStore(): Graph {
  const state = useGraphStore.getState();
  return {
    nodes: state.nodes,
    links: state.links,
    metadata: {},
  };
}

function applyGraphEditPatch(result: GraphEditResult): number {
  const store = useGraphStore.getState();
  const parentId = store.activeParentId;
  const createdIds = new Map<string, string>();
  let changes = 0;

  for (const linkId of result.deleteLinkIds) {
    if (useGraphStore.getState().links.some((link) => link.id === linkId)) {
      useGraphStore.getState().removeLink(linkId);
      changes += 1;
    }
  }

  for (const nodeId of result.deleteNodeIds) {
    if (useGraphStore.getState().nodes.some((node) => node.id === nodeId)) {
      useGraphStore.getState().removeNode(nodeId);
      changes += 1;
    }
  }

  for (const update of result.updateNodes) {
    const node = useGraphStore.getState().nodes.find((item) => item.id === update.id);
    if (!node) continue;
    const patch: Partial<NodeBase> = {};
    if (typeof update.title === "string" && update.title.trim()) patch.title = update.title.trim();
    if (typeof update.purpose === "string") patch.purpose = update.purpose;
    if (typeof update.summary === "string") patch.summary = update.summary;
    if (isNodeType(update.type)) patch.type = update.type;
    if (update.metadata && typeof update.metadata === "object") {
      patch.metadata = { ...(node.metadata ?? {}), ...update.metadata };
    }
    if (Object.keys(patch).length) {
      useGraphStore.getState().updateNode(node.id, patch);
      changes += 1;
    }
    if (update.data && typeof update.data === "object") {
      useGraphStore.getState().patchNodeData(node.id, update.data);
      changes += 1;
    }
  }

  const liveBeforeCreate = useGraphStore.getState().nodes;
  const visibleBeforeCreate = liveBeforeCreate.filter((node) => (node.parentId ?? null) === parentId);
  const layoutNodes = visibleBeforeCreate.length ? visibleBeforeCreate : liveBeforeCreate;
  const baseX = layoutNodes.length ? Math.max(...layoutNodes.map((node) => node.position.x)) + 280 : 80;
  const baseY = layoutNodes.length ? Math.min(...layoutNodes.map((node) => node.position.y)) : 80;

  for (const [index, raw] of result.createNodes.entries()) {
    const type = isNodeType(raw.type) ? raw.type : "task";
    const title = typeof raw.title === "string" && raw.title.trim() ? raw.title.trim() : "New Node";
    const x = baseX + index * 280;
    const y = baseY;
    const node = makeNode(type, title, { x, y }, parentId);
    const enriched: NodeBase = {
      ...node,
      purpose: typeof raw.purpose === "string" ? raw.purpose : undefined,
      summary: typeof raw.summary === "string" ? raw.summary : undefined,
      data: raw.data && typeof raw.data === "object" ? raw.data : {},
      metadata: {
        ...(raw.metadata && typeof raw.metadata === "object" ? raw.metadata : {}),
        createdBy: "llm-chat",
      },
    };
    useGraphStore.getState().addNode(enriched);
    if (raw.clientId) createdIds.set(raw.clientId, enriched.id);
    changes += 1;
  }

  for (const raw of result.createLinks) {
    const source = createdIds.get(raw.source) ?? raw.source;
    const target = createdIds.get(raw.target) ?? raw.target;
    const state = useGraphStore.getState();
    const sourceExists = state.nodes.some((node) => node.id === source);
    const targetExists = state.nodes.some((node) => node.id === target);
    const duplicate = state.links.some((link) => link.source === source && link.target === target);
    if (!sourceExists || !targetExists || source === target || duplicate) continue;
    const link: Edge = {
      id: crypto.randomUUID(),
      source,
      target,
      sourceHandle: raw.sourceHandle,
      targetHandle: raw.targetHandle,
      label: raw.label,
    };
    useGraphStore.getState().addLink(link);
    changes += 1;
  }

  return changes;
}

async function applyGraphChatStream(
  rawText: string,
  history: ChatHistoryMessage[],
  onText: (chunk: string) => void,
): Promise<GraphCommandResult> {
  const provider = useProviderStore.getState().provider;
  const model = useProviderStore.getState().getModel(provider);
  const apiKey = useKeyStore.getState().getKey(provider);
  const activeParentId = useGraphStore.getState().activeParentId;
  let streamed = "";
  let patchReply = "";
  let changes = 0;

  try {
    await editGraphWithChatStream(rawText, {
      history,
      graph: graphFromStore(),
      activeParentId,
      provider,
      model,
      apiKey,
      onText: (chunk) => {
        streamed += chunk;
        onText(chunk);
      },
      onPatch: (patch) => {
        patchReply = patch.reply;
        changes = applyGraphEditPatch(patch);
      },
    });
    const suffix = changes > 0 ? `\n\n已应用 ${changes} 个图表变更。` : "";
    return {
      ok: changes > 0,
      text: streamed.trim() ? suffix : `${patchReply || "已处理。"}${suffix}`,
    };
  } catch (error) {
    const fallback = applyGraphCommand(rawText);
    const reason = error instanceof Error ? error.message : String(error);
    return {
      ok: fallback.ok,
      text: fallback.ok
        ? `LLM 暂不可用，已使用本地解析执行。\n\n${fallback.text}`
        : `LLM 暂不可用，本地解析也没有执行变更。\n\n${fallback.text || reason}`,
    };
  }
}

function applyGraphCommand(rawText: string): GraphCommandResult {
  const text = cleanInput(rawText);
  const initialState = useGraphStore.getState();
  const parentId = initialState.activeParentId;
  const responses: string[] = [];

  if (/^(help|帮助|可以做什么)$/i.test(text)) {
    return {
      ok: true,
      text: "我可以创建节点、连接节点、重命名节点、标记状态、选择节点和删除节点。比如：创建任务节点 需求分析；连接 需求分析 到 Context Builder；把 需求分析 标记为 done。",
    };
  }

  for (const clause of splitClauses(text)) {
    const state = useGraphStore.getState();
    if (/(连接|连线|connect|link|->|→|到)/i.test(clause) && !/(创建|新建|添加|删除|重命名|改名)/.test(clause)) {
      const parts = clause
        .replace(/^(请|帮我|把)?\s*(连接|连线|connect|link)\s*/i, "")
        .split(/\s*(?:->|→|到|至|和|with)\s*/i)
        .map((part) => part.trim())
        .filter(Boolean);
      if (parts.length >= 2) {
        const source = findNode(state.nodes, parts[0], parentId);
        const target = findNode(state.nodes, parts[1], parentId);
        if (!source || !target) {
          responses.push(`没有找到要连接的节点：${!source ? parts[0] : parts[1]}`);
          continue;
        }
        if (source.id === target.id) {
          responses.push("不能把节点连接到它自己。");
          continue;
        }
        const exists = state.links.some((link) => link.source === source.id && link.target === target.id);
        if (exists) {
          responses.push(`已存在连线：${source.title} -> ${target.title}`);
          continue;
        }
        useGraphStore.getState().addLink({
          id: crypto.randomUUID(),
          source: source.id,
          target: target.id,
          label: "chat",
        });
        responses.push(`已连接：${source.title} -> ${target.title}`);
        continue;
      }
    }

    if (/(重命名|改名|rename|标题改为|标题为)/i.test(clause)) {
      const match = clause.match(/(?:把)?\s*(.+?)\s*(?:重命名为|改名为|标题改为|标题为|rename\s+to)\s*(.+)$/i);
      if (!match) {
        responses.push("没有识别到重命名格式。");
        continue;
      }
      const node = findNode(state.nodes, match[1], parentId);
      const title = quotedText(match[2]) ?? match[2].trim();
      if (!node) {
        responses.push(`没有找到节点：${match[1].trim()}`);
        continue;
      }
      useGraphStore.getState().updateNode(node.id, { title });
      responses.push(`已重命名：${node.title} -> ${title}`);
      continue;
    }

    if (/(标记|状态|mark|status)/i.test(clause)) {
      const status = parseStatus(clause);
      const name = clause
        .replace(/(?:标记为|状态改为|状态为|mark as|status to|status is).+$/i, "")
        .replace(/^(把|将|节点)\s*/i, "")
        .trim();
      const node = findNode(state.nodes, name, parentId) ?? (state.selectedNodeId ? state.nodes.find((item) => item.id === state.selectedNodeId) : undefined);
      if (!status) {
        responses.push("没有识别到状态。");
        continue;
      }
      if (!node) {
        responses.push(`没有找到节点：${name || "当前选中节点"}`);
        continue;
      }
      useGraphStore.getState().patchNodeData(node.id, { status });
      responses.push(`已标记：${node.title} = ${status}`);
      continue;
    }

    if (/(删除|移除|delete|remove)/i.test(clause)) {
      const name = clause.replace(/^(请|帮我|把)?\s*(删除|移除|delete|remove)\s*/i, "").replace(/节点$/i, "").trim();
      const node = findNode(state.nodes, name, parentId);
      if (!node) {
        responses.push(`没有找到节点：${name}`);
        continue;
      }
      useGraphStore.getState().removeNode(node.id);
      responses.push(`已删除节点：${node.title}`);
      continue;
    }

    if (/(选择|选中|select)/i.test(clause)) {
      const name = clause.replace(/^(请|帮我)?\s*(选择|选中|select)\s*/i, "").trim();
      const node = findNode(state.nodes, name, parentId);
      if (!node) {
        responses.push(`没有找到节点：${name}`);
        continue;
      }
      useGraphStore.getState().selectNode(node.id);
      responses.push(`已选中节点：${node.title}`);
      continue;
    }

    if (/(创建|新建|添加|建立|add|create|make)/i.test(clause)) {
      const detected = detectType(clause);
      const rawTitle = extractNodeTitle(clause, detected.label);
      const titles = rawTitle
        .split(/\s*[,，、]\s*/)
        .map((item) => item.trim())
        .filter(Boolean);
      const liveNodes = useGraphStore.getState().nodes;
      const visibleNodes = liveNodes.filter((node) => (node.parentId ?? null) === parentId);
      const currentNodes = visibleNodes.length ? visibleNodes : liveNodes;
      const baseX = currentNodes.length ? Math.max(...currentNodes.map((node) => node.position.x)) + 280 : 80;
      const baseY = currentNodes.length ? Math.min(...currentNodes.map((node) => node.position.y)) : 80;
      for (const [index, title] of titles.entries()) {
        const node = makeNode(detected.type, title, { x: baseX + index * 280, y: baseY }, parentId);
        useGraphStore.getState().addNode(node);
        responses.push(`已创建 ${detected.label} 节点：${title}`);
      }
      continue;
    }

    responses.push(`我还不能理解这句：${clause}`);
  }

  return {
    ok: responses.some((line) => line.startsWith("已")),
    text: responses.join("\n"),
  };
}

export default function ChatBox({ embedded = false }: { embedded?: boolean } = {}) {
  const rightOpen = usePanelStore((s) => s.rightOpen);
  const nodeCount = useGraphStore((s) => s.nodes.length);
  const linkCount = useGraphStore((s) => s.links.length);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const graphSummary = useMemo(() => `${nodeCount} nodes / ${linkCount} links`, [nodeCount, linkCount]);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  if (!embedded && !rightOpen) return null;

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    const userMsg: Message = { id: crypto.randomUUID(), role: "user", content: text };
    const assistantId = crypto.randomUUID();
    const history: ChatHistoryMessage[] = messages.slice(-12).map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));
    setMessages((prev) => [...prev, userMsg, { id: assistantId, role: "assistant", content: "" }]);
    setDraft("");
    setSending(true);
    const appendAssistant = (chunk: string) => {
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantId ? { ...msg, content: `${msg.content}${chunk}` } : msg,
        ),
      );
    };
    const result = await applyGraphChatStream(text, history, appendAssistant);
    setSending(false);
    const finalText = result.text || (result.ok ? "已更新图表。" : "没有执行任何图表变更。");
    setMessages((prev) =>
      prev.map((msg) =>
        msg.id === assistantId
          ? { ...msg, content: msg.content ? `${msg.content}${finalText}` : finalText }
          : msg,
      ),
    );
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className={`${embedded ? "" : "border-l border-zinc-800"} bg-panel flex flex-col h-full`}>
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-zinc-800 text-xs">
        <div className="min-w-0">
          <div className="font-semibold text-zinc-300">图表助手</div>
          <div className="text-[10px] text-zinc-600">{graphSummary}</div>
        </div>
        {messages.length > 0 && (
          <button
            className="text-zinc-500 hover:text-accent"
            onClick={() => setMessages([])}
            title="清空对话"
          >
            Clear
          </button>
        )}
      </div>

      <div ref={listRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-2 text-xs">
        {messages.length === 0 && !sending ? (
          <div className="h-full flex items-center justify-center text-zinc-600 italic">
            输入图表编辑指令
          </div>
        ) : (
          <>
            {messages.map((m) => (
              <div
                key={m.id}
                className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-md px-2.5 py-1.5 whitespace-pre-wrap leading-relaxed ${
                    m.role === "user"
                      ? "bg-accent/20 text-accent border border-accent/30"
                      : "bg-canvas text-zinc-300 border border-zinc-800"
                  }`}
                >
                  {m.content}
                </div>
              </div>
            ))}
            {sending && (
              <div className="flex justify-start">
                <div className="max-w-[85%] rounded-md px-2.5 py-1.5 leading-relaxed bg-canvas text-zinc-500 border border-zinc-800">
                  正在调用 LLM…
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <div className="border-t border-zinc-800 p-2">
        <textarea
          className="w-full bg-canvas border border-zinc-700 rounded px-2 py-1.5 text-xs outline-none focus:border-accent resize-none leading-relaxed"
          rows={3}
          placeholder="输入消息，Enter 发送 / Shift+Enter 换行"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="flex justify-end mt-1.5">
          <button
            className="px-3 py-1 bg-accent rounded text-xs disabled:opacity-50"
            onClick={send}
            disabled={!draft.trim() || sending}
          >
            {sending ? "处理中" : "发送"}
          </button>
        </div>
      </div>
    </div>
  );
}
