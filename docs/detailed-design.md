# 详细设计文档 — MindAgentGraph

> 标注说明：`[新增]` 全新模块、`[修改]` 需改动已有模块

---

## 模块 M1：App 布局重构 `[修改]`

### 文件
[frontend/src/App.tsx](frontend/src/App.tsx)

### 职责
将当前 2 列固定布局升级为 4 区可拖拽调整布局。

### 数据模型变更

```typescript
// 新增：面板状态
interface PanelState {
  leftOpen: boolean;
  leftWidth: number;      // 默认 280px
  rightOpen: boolean;
  rightWidth: number;     // 默认 320px
  bottomOpen: boolean;
  bottomHeight: number;   // 默认 200px
}
```

### 布局结构变更

```
旧: grid-rows-[auto_auto_1fr] grid-cols-[1fr_320px]
新: 使用 react-resizable-panels 实现 4 区拖拽布局

┌──────────┬──────────────────────┬──────────┐
│          │     Toolbar          │          │
│  Left    ├──────────────────────┤  Right   │
│  Panel   │     PlanInput        │  Panel   │
│  (280px) ├──────────────────────┤ (320px)  │
│          │     Canvas           │          │
│          │     (ReactFlow)      │          │
├──────────┴──────────────────────┴──────────┤
│              Bottom Panel (200px)           │
└─────────────────────────────────────────────┘
```

### 组件树变更

```tsx
// 旧
<div className="grid grid-rows-[auto_auto_1fr] grid-cols-[1fr_320px]">
  <Toolbar />        // col-span-2
  <PlanInput />      // col-span-2
  <Canvas />         // left
  <NodeInspector />  // right
</div>

// 新
<PanelGroup direction="vertical">
  <PanelGroup direction="horizontal">
    <LeftPanel />          // 可折叠，默认 280px
    <Panel>
      <Toolbar />
      <PlanInput />
      <Canvas />
    </Panel>
    <RightPanel />         // 可折叠，默认 320px
  </PanelGroup>
  <BottomPanel />          // 可折叠，默认 200px
</PanelGroup>
```

### 新增依赖
- `react-resizable-panels` (npm)

### 向后兼容
- Toolbar/PlanInput/Canvas/NodeInspector 组件无需改动
- 折叠左侧/底部面板时布局退化到接近当前状态

---

## 模块 M2：左侧面板 ProjectExplorer `[新增]`

### 文件
- [frontend/src/components/ProjectExplorer.tsx](frontend/src/components/ProjectExplorer.tsx)
- [frontend/src/store/panelStore.ts](frontend/src/store/panelStore.ts)

### 职责
- 以树形结构展示当前图中所有节点
- 支持点击节点名跳转/选中画布对应节点
- 展示项目文件结构（.mag 目录内容）
- Agent 列表（筛选 type=agent 的节点）

### 界面结构

```
┌─ ProjectExplorer ──────────────┐
│ [节点树] [文件] [Agent]  ← Tab  │
├────────────────────────────────┤
│ ▼ CityGenerator                │
│   ├ ◉ Terrain                  │
│   ├ ◉ Road                     │
│   │  └ ◉ LaneGenerator ← 缩进  │
│   ├ ◉ Building                 │
│   └ ◉ NPC                      │
│                                 │
│ (点击节点 → selectNode)         │
│ (右键 → 删除/重命名)            │
│ (拖拽排序 → 重排 DAG 布局)      │
└────────────────────────────────┘
```

### 接口

```typescript
interface ProjectExplorerProps {
  // 从 graphStore 读取 nodes/links/selectedNodeId
}

// panelStore
interface PanelStateStore {
  leftOpen: boolean;
  leftWidth: number;
  rightOpen: boolean;
  rightWidth: number;
  bottomOpen: boolean;
  bottomHeight: number;
  activeLeftTab: "tree" | "files" | "agents";
  activeBottomTab: "logs" | "comm" | "tokens";
  toggleLeft: () => void;
  toggleRight: () => void;
  toggleBottom: () => void;
}
```

### 关键算法：节点树生成

```typescript
function buildNodeTree(nodes: NodeBase[], links: Edge[]): TreeNode[] {
  // 1. 找到所有入度为 0 的根节点
  const inDegree = new Map<string, number>();
  const children = new Map<string, string[]>();
  for (const e of links) {
    inDegree.set(e.target, (inDegree.get(e.target) || 0) + 1);
    const c = children.get(e.source) || [];
    c.push(e.target);
    children.set(e.source, c);
  }
  // 2. 从根节点开始 BFS/DFS 构建树
  const roots = nodes.filter(n => !inDegree.has(n.id));
  // 3. 递归构建 TreeNode（处理循环引用）
  ...
}
```

### 与现有模块交互
- 读取 `graphStore.nodes` / `graphStore.links`
- 调用 `graphStore.selectNode(id)` 联动画布
- Tab "Agent" 筛选 `node.type === "agent"` 的节点

---

## 模块 M3：底部面板 BottomMonitor `[新增]`

### 文件
- [frontend/src/components/BottomMonitor.tsx](frontend/src/components/BottomMonitor.tsx)

### 职责
- **日志 Tab：** 显示 AI 调用日志（请求/响应/错误）
- **通信 Tab：** 显示 Agent 间消息记录（Phase 2+）
- **Token Tab：** 统计 Token 消耗（按 Provider/节点 汇总）

### 接口

```typescript
interface LogEntry {
  id: string;
  timestamp: number;
  nodeId?: string;
  nodeTitle?: string;
  type: "plan" | "explain" | "code" | "agent" | "error";
  message: string;
}

interface TokenUsage {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  nodeId: string;
  timestamp: number;
}
```

### 状态管理

```typescript
// 扩展 graphStore 或新建 monitorStore
interface MonitorState {
  logs: LogEntry[];
  tokenUsages: TokenUsage[];
  addLog: (entry: LogEntry) => void;
  addTokenUsage: (usage: TokenUsage) => void;
  clearLogs: () => void;
}
```

### 数据来源
- **日志：** 来自于 API 调用层（api/backend.ts）在每次 fetch 时 push
- **Token：** 后端 `/run/node` 和 `/run/node/code` 的 SSE 流中追加 `token` 事件，携带 usage 信息
- **Agent 通信：** Phase 2 从 AgentComm 的 WebSocket/SSE 获取

### Token 事件的 SSE 格式（后端新增）

```
event: token
data: {"input": 1234, "output": 567, "model": "claude-sonnet-4-6"}
```

---

## 模块 M4：数据模型扩展 `[修改]`

### 文件
- [shared/types.ts](shared/types.ts)
- [backend/app/schemas.py](backend/app/schemas.py)

### NodeBase 扩展

```typescript
interface NodeBase {
  // --- 已有字段保持不变 ---
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

  // --- 新增字段（Optional，向后兼容）---
  groupId?: string;          // 所属分组 ID
  parentGraphId?: string;    // 所属子图 ID（null=主图）
  isCollapsed?: boolean;     // 分组折叠状态
  subGraphRef?: string;      // 指向子图文件 graphs/<id>.json
  ports?: Port[];            // SubGraph 暴露的输入/输出端口
  annotation?: string;       // 节点上的便签文本
}

interface Port {
  id: string;
  label: string;
  direction: "input" | "output";
  type: "text" | "file" | "any";
}
```

### 新增顶层类型

```typescript
// 分组
interface Group {
  id: string;
  title: string;
  position: Position;
  size: { width: number; height: number };
  color?: string;
  isCollapsed: boolean;
}

// 子图
interface SubGraph {
  id: string;
  name: string;
  nodes: NodeBase[];
  links: Edge[];
  ports: Port[];
  parentNodeId: string;  // 父图中指向此子图的节点
}

// 注解
interface Annotation {
  id: string;
  text: string;
  position: Position;
  color?: string;
}
```

### Graph 扩展

```typescript
interface Graph {
  nodes: NodeBase[];
  links: Edge[];
  groups?: Group[];          // 新增
  annotations?: Annotation[]; // 新增
  subGraphs?: SubGraph[];    // 新增
}
```

### 后端 schemas.py 对应变更

```python
class Node(BaseModel):
    # ... 已有字段全部保留 ...
    
    # 新增
    groupId: Optional[str] = None
    parentGraphId: Optional[str] = None
    isCollapsed: Optional[bool] = None
    subGraphRef: Optional[str] = None
    annotation: Optional[str] = None

class Group(BaseModel):
    id: str
    title: str
    position: Position
    size: Size
    color: Optional[str] = None
    isCollapsed: bool = False

class Annotation(BaseModel):
    id: str
    text: str
    position: Position
    color: Optional[str] = None

class Graph(BaseModel):
    nodes: list[Node]
    links: list[Edge]
    groups: list[Group] = Field(default_factory=list)
    annotations: list[Annotation] = Field(default_factory=list)
    subGraphs: list[dict[str, Any]] = Field(default_factory=list)
```

### 向后兼容策略
- 所有新增字段 `Optional`，默认值 `None` / `[]`
- 已有 .mag 文件 JSON 缺少新字段时，反序列化自动填默认值
- Graph 序列化时 `exclude_none=True` 可选，避免 .mag 文件膨胀

---

## 模块 M5：AgentRuntime 运行时 `[新增]`

### 文件
- [backend/app/services/agent_runtime.py](backend/app/services/agent_runtime.py)

### 职责
- Agent 节点的专用执行引擎
- 管理 Agent 生命周期：spawn → run → monitor → terminate
- 为每个 Agent 创建独立上下文沙箱
- 调度 Agent 执行（顺序/并行）

### 核心类设计

```python
from dataclasses import dataclass, field
from typing import AsyncIterator, Optional
from enum import Enum

class AgentState(str, Enum):
    IDLE = "idle"
    RUNNING = "running"
    WAITING = "waiting"       # 等待上游结果
    ERROR = "error"
    DONE = "done"

@dataclass
class AgentContext:
    """单个 Agent 的运行时上下文"""
    node_id: str
    node_title: str
    system_prompt: str
    memory_text: Optional[str]
    file_scope_allow: list[str]
    file_scope_deny: list[str]
    tool_policy: ToolPolicy
    state: AgentState = AgentState.IDLE
    inbox: list["AgentMessage"] = field(default_factory=list)
    outbox: list["AgentMessage"] = field(default_factory=list)

@dataclass
class AgentMessage:
    id: str
    from_agent: str
    to_agent: str          # "" = broadcast
    content: str
    timestamp: float
    msg_type: str          # "task", "result", "query", "notify"
```

### 对外接口

```python
class AgentRuntime:
    def __init__(self, provider: str, model: str | None = None, api_key: str | None = None):
        ...

    async def spawn(
        self,
        node: Node,
        memory_text: str | None = None,
        upstream_results: dict[str, str] | None = None,
    ) -> AgentContext:
        """创建 Agent 上下文实例"""
        ...

    async def run(
        self,
        agent: AgentContext,
        task_prompt: str,
        parent_outputs: dict[str, str] | None = None,
    ) -> AsyncIterator[str]:
        """执行单个 Agent，返回 SSE 文本流"""
        ...

    async def terminate(self, agent: AgentContext) -> None:
        """结束 Agent，清理上下文"""
        ...

    async def run_parallel(
        self,
        agents: list[AgentContext],
        task_prompts: dict[str, str],  # agent_id -> prompt
    ) -> dict[str, str]:
        """并行执行多个 Agent，返回 {agent_id: result}"""
        ...
```

### 与现有模块的关系

```
AgentRuntime
  ├── 复用 runner.py._build_user_message() 组装上下文
  ├── 复用 Provider 抽象层发 LLM 请求
  ├── 新增 Agent 间消息传递（AgentComm）
  └── 结果写入 memory.py write_memory()
```

### 关键算法：Agent 执行流程

```
1. 接收执行请求（来自 Supervisor 或用户手动触发）
2. AgentContext 初始化：
   a. 加载 memoryRef 对应 .mag/memory/ 内容
   b. 解析 fileScope / toolPolicy
   c. 注入 parentOutputs（如果有上游）
3. 组装 System Prompt：
   = NODE_RUN_SYSTEM 基类
   + "你是一个 Agent 节点，职责范围是：{node_purpose}"
   + fileScope 约束："你只能操作这些文件：{allow}"
   + toolPolicy："可用工具：{tools}"
4. 调用 Provider.stream_text() 流式输出
5. 实时 SSE 推送（复用现有 SSE wire format）
6. 完成后：
   a. 如有 agent 间消息（outbox），通过 AgentComm 投递
   b. 写 memory（非 isolated 模式）
```

### 错误处理
- Agent 执行超时 → 发送 error SSE 事件，状态 → ERROR
- Provider 错误 → 降级到离线 demo 模式（复用 runner.py 策略）
- Agent 间消息投递失败 → 暂存 outbox，下次重试

---

## 模块 M6：AgentComm 通信协议 `[新增]`

### 文件
- [backend/app/services/agent_comm.py](backend/app/services/agent_comm.py)

### 职责
- Agent 间消息传递
- Supervisor → Worker 任务分发
- Worker → Supervisor 结果回报
- 消息持久化和重放

### 对外接口

```python
class AgentComm:
    def __init__(self):
        self.messages: list[AgentMessage] = []
        self.subscribers: dict[str, asyncio.Queue] = {}

    async def send(self, msg: AgentMessage) -> None:
        """发送消息到指定 Agent 的 inbox"""
        ...

    async def broadcast(self, msg: AgentMessage) -> None:
        """广播到所有活跃 Agent"""
        ...

    async def receive(self, agent_id: str, timeout: float = 30.0) -> AgentMessage | None:
        """阻塞等待消息"""
        ...

    async def subscribe(self, agent_id: str) -> None:
        """注册 Agent 的消息队列"""
        ...

    def get_history(self, agent_id: str | None = None) -> list[AgentMessage]:
        """获取消息历史"""
        ...
```

### 消息路由规则

| msg_type | 方向 | 说明 |
|----------|------|------|
| `task` | Supervisor → Worker | 任务分配 |
| `result` | Worker → Supervisor | 结果反馈 |
| `query` | Worker → Worker | 点对点咨询 |
| `notify` | Any → Any | 通知（进度/状态变更） |

### OpenAI 兼容消息格式（未来跨 Agent 互操作）

```python
# Agent 间消息同时支持 OpenAI ChatMessage 格式
{
    "role": "assistant",    # 或 "user" (来自其他 Agent)
    "name": "RoadAgent",    # Agent 标识
    "content": "..."
}
```

---

## 模块 M7：Supervisor 调度器 `[新增]`

### 文件
- [backend/app/services/supervisor.py](backend/app/services/supervisor.py)

### 职责
- 读取 DAG 图结构
- 按拓扑顺序分解任务
- 分配给 Agent 节点执行
- 聚合节点结果
- 处理执行失败和重试

### 对外接口

```python
class Supervisor:
    def __init__(self, agent_runtime: AgentRuntime, agent_comm: AgentComm):
        self.runtime = agent_runtime
        self.comm = agent_comm

    async def execute_dag(
        self,
        graph: Graph,
        project_path: str,
    ) -> AsyncIterator[DAGProgress]:
        """执行整个 DAG，返回进度事件流"""
        ...

    async def execute_node(
        self,
        node: Node,
        parent_results: dict[str, str],
    ) -> str:
        """执行单个节点（非 Agent 类型则回退到现有 Runner）"""
        ...
```

### DAG 执行算法（改进现有关键路径执行）

```python
async def execute_dag(self, graph: Graph, project_path: str):
    # 1. 拓扑排序
    order = topological_sort(graph.nodes, graph.links)
    # 2. 按层级分组（同一层可并行）
    levels = group_by_level(order, graph.links)
    results: dict[str, str] = {}
    
    for level in levels:
        # 3. 并行执行同层节点
        tasks = []
        for node in level:
            parents = get_parents(node.id, graph.links)
            parent_results = {p: results[p] for p in parents if p in results}
            
            if node.type == "agent":
                # Agent 节点 → AgentRuntime
                agent = await self.runtime.spawn(node, ...)
                tasks.append(self.runtime.run(agent, ...))
            else:
                # 非 Agent 节点 → 现有 Runner
                tasks.append(run_node_stream(...))
        
        level_results = await asyncio.gather(*tasks, return_exceptions=True)
        # 4. 收集结果，处理错误
        for node, result in zip(level, level_results):
            if isinstance(result, Exception):
                yield DAGProgress(node_id=node.id, status="error", error=str(result))
            else:
                results[node.id] = result
                yield DAGProgress(node_id=node.id, status="done")
```

### 改进点（相比当前 RunDAG）

| 维度 | 当前 | 改进后 |
|------|------|--------|
| 执行模式 | 严格串行 | 同层并行 |
| 错误处理 | 单点失败即停 | 可配置：continue-on-error |
| Agent 感知 | 无区别 | Agent 节点走专用运行时 |
| 进度反馈 | 无 | SSE 进度事件流 |
| 取消粒度 | 粗粒度（全取消） | 细粒度（单节点取消） |

---

## 模块 M8：SubGraph 子图系统 `[新增]`

### 文件
- [frontend/src/components/SubGraphEditor.tsx](frontend/src/components/SubGraphEditor.tsx)
- [backend/app/services/subgraph.py](backend/app/services/subgraph.py)

### 职责
- 允许节点包含一个嵌套的子图
- 子图有独立画布、独立节点集合
- 子图暴露 Port（输入/输出）供父图连线
- 支持面包屑导航

### 数据模型

```typescript
// 子图存储结构：graphs/<subgraph-id>.json = Graph
// 父图节点引用：
{
  "id": "road-system",
  "type": "agent",
  "title": "Road System",
  "subGraphRef": "graphs/road-system.json",
  "ports": [
    { "id": "in-city-layout", "label": "City Layout", "direction": "input" },
    { "id": "out-road-network", "label": "Road Network", "direction": "output" }
  ]
}
```

### 前端 SubGraphEditor 行为

1. **进入子图：** 双击 `subGraphRef` 不为空的节点 → 切换到子图画布
2. **面包屑：** 顶部显示 `主图 > RoadSystem > LaneGenerator`
3. **返回父图：** 点击面包屑第一级，或按 Escape
4. **Port 连线：** 子图输入 Port 连到上游节点，输出 Port 连到下游节点

### 后端 API

```python
# 新增路由
@app.get("/graph/{graph_id}")
async def get_graph(project_path: str, graph_id: str) -> Graph:
    """读取任意子图"""
    ...

@app.post("/graph/{graph_id}")
async def save_graph(project_path: str, graph_id: str, graph: Graph) -> None:
    """保存子图"""
    ...
```

### 状态管理扩展

```typescript
// graphStore 新增
interface GraphState {
  // ... 已有字段 ...
  currentGraphId: string;           // 当前显示的子图 ID（"main" = 主图）
  graphStack: string[];             // 面包屑导航栈
  subGraphs: Map<string, Graph>;   // 所有已加载子图缓存
  
  enterSubGraph: (graphId: string) => void;
  exitSubGraph: () => void;
}
```

---

## 模块 M9：节点分组与注释 `[新增]`

### 文件
- [frontend/src/components/Canvas.tsx](frontend/src/components/Canvas.tsx) `[修改]`
- ReactFlow 内置 `Group` 和 `NodeToolbar` 能力

### 分组功能

利用 ReactFlow 的 **group node** 机制：

```typescript
// 分组节点是一种特殊的 ReactFlow node
const groupNode = {
  id: "group-1",
  type: "group",       // ReactFlow 内置 group 类型
  position: { x: 100, y: 100 },
  style: { width: 400, height: 300 },
  data: { label: "道路系统" },
};

// 普通节点通过 parentId 关联到分组
const childNode = {
  id: "road",
  parentId: "group-1",  // ReactFlow 内置 parentNode
  extent: "parent",     // 限制在父节点内拖拽
  position: { x: 50, y: 50 },
  ...
};
```

操作方式：
- **创建分组：** 框选多个节点 → 右键 → "创建分组"
- **取消分组：** 右键分组 → "解散分组"（不删除子节点）
- **折叠/展开：** 双击分组标题（折叠时子节点隐藏）
- **拖拽分组：** 拖拽分组标题栏，所有子节点跟随移动

### 注释功能

```typescript
// 注释是一种特殊的 ReactFlow node（透明背景，不可连线）
const annotationNode = {
  id: "note-1",
  type: "annotation",  // 自定义节点类型
  position: { x: 0, y: 0 },
  style: { width: 200, height: 100 },
  data: {
    text: "TODO: 这里需要优化",
    color: "#fbbf24",  // yellow
  },
  draggable: true,
  selectable: true,
  connectable: false,
};
```

---

## 模块 M10：SemanticIndex 语义索引 `[新增]`

### 文件
- [backend/app/services/semantic_index.py](backend/app/services/semantic_index.py)

### 职责
- 对 .mag/memory/ 目录建立向量索引
- 支持语义相似度搜索
- 支持自动记忆压缩（摘要替代原文）

### 技术选型
- **embedding 模型：** sentence-transformers (all-MiniLM-L6-v2, 本地运行)
- **向量存储：** SQLite + sqlite-vec 扩展（零外部依赖）
- 备选：ChromaDB（需要 Python 进程，但查询更高效）

### 对外接口

```python
class SemanticIndex:
    def __init__(self, memory_dir: Path):
        self.memory_dir = memory_dir
        self.model = SentenceTransformer("all-MiniLM-L6-v2")

    async def index_all(self) -> int:
        """索引所有 .mag/memory/ 下的 .md 文件，返回索引数量"""
        ...

    async def search(self, query: str, top_k: int = 5) -> list[SearchResult]:
        """语义搜索最相关的记忆"""
        ...

    async def compress(self, memory_ref: str, max_tokens: int = 2000) -> str:
        """压缩过长记忆：调用 LLM 生成摘要，替换原文件"""
        ...

@dataclass
class SearchResult:
    memory_ref: str
    node_title: str
    similarity: float
    snippet: str
```

### 索引更新策略
- **写时更新：** `write_memory()` 后自动 re-index 该文件
- **批量重建：** 提供 `POST /memory/reindex` 手动触发
- **增量检测：** 比较文件 mtime，只 re-index 变更文件

---

## 模块 M11：TaskQueue 任务队列 `[新增]`

### 文件
- [backend/app/services/task_queue.py](backend/app/services/task_queue.py)

### 职责
- 持久化任务队列（JSON 文件）
- 支持排队、重试、暂停/恢复
- 支持优先级调度

### 数据模型

```python
@dataclass
class QueuedTask:
    id: str
    node_id: str
    task_type: str        # "explain" | "code" | "agent"
    priority: int = 0     # 越大越优先
    status: str = "pending"  # pending | running | done | failed | cancelled
    retries: int = 0
    max_retries: int = 3
    created_at: float
    payload: dict         # 传递给 executor 的参数
    result: str | None = None
    error: str | None = None
```

### 对外接口

```python
class TaskQueue:
    def __init__(self, queue_path: Path):
        self.queue_path = queue_path
        self._tasks: dict[str, QueuedTask] = {}

    async def enqueue(self, task: QueuedTask) -> None: ...
    async def dequeue(self) -> QueuedTask | None: ...
    async def mark_done(self, task_id: str, result: str) -> None: ...
    async def mark_failed(self, task_id: str, error: str, retry: bool = True) -> None: ...
    async def pause(self) -> None: ...
    async def resume(self) -> None: ...
    def pending_count(self) -> int: ...
    
    # 持久化
    def _save(self) -> None:
        """序列化到 .mag/.cache/task_queue.json"""
        ...
```

### 持久化位置
`.mag/.cache/task_queue.json`

### 调度策略
```
优先级队列（heapq）：
1. priority 高的先执行
2. 同优先级 FIFO
3. failed 任务 retries < max_retries → priority -1 重新入队
4. 依赖任务完成后自动 enqueue 下游任务
```

---

## 模块 M12：ResourceManager 资源管理 `[新增]`

### 文件
- [backend/app/services/resource_manager.py](backend/app/services/resource_manager.py)
- [frontend/src/components/ResourcePanel.tsx](frontend/src/components/ResourcePanel.tsx)

### 职责
- 多模态资源（图片、视频、音频、文档、3D）CRUD
- 资源存储在 .mag/assets/ 下
- 缩略图生成
- 资源引用追踪

### 数据模型

```python
class Resource(BaseModel):
    id: str
    name: str
    type: str       # "image" | "video" | "audio" | "document" | "3d" | "other"
    path: str       # 相对于 .mag/assets/ 的路径
    mime_type: str
    size_bytes: int
    thumbnail_path: str | None
    node_refs: list[str]  # 引用此资源的节点 ID
    created_at: float
```

### 目录结构

```
.mag/assets/
├── index.json           # 资源索引 [{Resource}]
├── images/
│   ├── reference-01.png
│   └── thumbnails/
│       └── reference-01_thumb.png
├── documents/
└── other/
```

### NodeInspector 集成

右侧面板新增 "资源" Tab：
- 拖拽文件到节点 → 绑定资源
- 显示已绑定资源列表（缩略图 + 名称）
- 点击资源 → 预览（图片/视频）或打开（文档）

---

## 模块 M13：新 Provider 适配器 `[新增]`

### 文件
- [backend/app/services/providers/openai_provider.py](backend/app/services/providers/openai_provider.py)
- [backend/app/services/providers/gemini_provider.py](backend/app/services/providers/gemini_provider.py)

### 设计

复用现有 `PlanProvider` protocol（`backend/app/services/providers/base.py`）：

```python
class PlanProvider(Protocol):
    async def plan_graph(self, goal: str, model: str | None = None) -> Graph: ...
    async def stream_text(self, system_prompt: str, user_message: str,
                          model: str | None = None) -> AsyncIterator[str]: ...

class OpenAIProvider:
    """OpenAI GPT-4o / GPT-5 适配，支持 json_object + streaming"""
    ...

class GeminiProvider:
    """Google Gemini 适配，通过 OpenAI SDK 兼容模式或原生 SDK"""
    ...
```

### 注册

```python
# planner.py 的 _PROVIDERS 字典扩展
_PROVIDERS = {
    "anthropic": AnthropicProvider(),
    "deepseek": DeepSeekProvider(),
    "openai": OpenAIProvider(),      # 新增
    "gemini": GeminiProvider(),      # 新增
}
```

---

## 模块 M14：MCPGateway MCP 工具网关 `[新增]`

### 文件
- [backend/app/services/mcp_gateway.py](backend/app/services/mcp_gateway.py)

### 职责
- 实现 MCP Server 端（stdio 或 HTTP transport）
- 工具注册与发现
- 按 Agent 节点的 toolPolicy 控制工具可用权限

### 设计

```python
class MCPGateway:
    def __init__(self):
        self._tools: dict[str, MCPTool] = {}
    
    def register(self, tool: MCPTool) -> None: ...
    def list_tools(self, node_id: str) -> list[MCPTool]:
        """根据节点的 toolPolicy 返回可用工具列表"""
        ...
    async def call_tool(self, node_id: str, tool_name: str, params: dict) -> str:
        """执行工具调用，检查权限"""
        ...

@dataclass
class MCPTool:
    name: str
    description: str
    input_schema: dict    # JSON Schema
    handler: callable
    category: str          # "fs" | "git" | "web" | "ue5" | "custom"
```

### 内置工具

| 工具名 | 类别 | 功能 |
|--------|------|------|
| `read_file` | fs | 读取文件（受 fileScope 约束） |
| `write_file` | fs | 写入文件（受 fileScope 约束） |
| `list_dir` | fs | 列出目录 |
| `git_diff` | git | 查看变更 |
| `git_log` | git | 查看提交历史 |
| `web_search` | web | 网络搜索 |
| `run_shell` | shell | 执行 Shell 命令（沙箱） |

---

## 模块 M15：App 路由与 API 汇总

### 新增 API 路由

| 方法 | 路径 | 模块 | 说明 |
|------|------|------|------|
| `GET` | `/health` | ✅ 已有 | 健康检查 |
| `POST` | `/plan` | ✅ 已有 | 一句话生成图 |
| `POST` | `/run/node` | ✅ 已有 | 执行节点（SSE） |
| `POST` | `/run/node/code` | ✅ 已有 | 代码生成（SSE） |
| `POST` | `/run/node/code/cancel` | ✅ 已有 | 取消代码生成 |
| `POST` | `/agent/spawn` | 🆕 | 创建 Agent 上下文 |
| `POST` | `/agent/run` | 🆕 | 执行 Agent（SSE） |
| `POST` | `/agent/terminate` | 🆕 | 终止 Agent |
| `POST` | `/dag/execute` | 🆕 | 执行整个 DAG（带 Agent 支持，SSE） |
| `GET` | `/graph/{id}` | 🆕 | 读取子图 |
| `POST` | `/graph/{id}` | 🆕 | 保存子图 |
| `POST` | `/memory/reindex` | 🆕 | 重建语义索引 |
| `GET` | `/memory/search` | 🆕 | 语义搜索记忆 |
| `POST` | `/memory/compress` | 🆕 | 压缩记忆 |
| `GET` | `/resource/list` | 🆕 | 列出资源 |
| `POST` | `/resource/upload` | 🆕 | 上传资源 |
| `POST` | `/tasks/enqueue` | 🆕 | 加入任务队列 |
| `GET` | `/tasks/status` | 🆕 | 队列状态 |
| `GET` | `/mcp/tools` | 🆕 | MCP 工具列表 |
| `POST` | `/mcp/call` | 🆕 | 调用 MCP 工具 |

---

## 模块依赖总览

```
M2 (ProjectExplorer)  →  M4 (类型扩展), graphStore
M3 (BottomMonitor)    →  M5 (AgentRuntime, SSE事件), monitorStore
M5 (AgentRuntime)     →  runner.py (上下文组装), Provider, M6 (AgentComm)
M6 (AgentComm)        →  无外部依赖（纯消息队列）
M7 (Supervisor)       →  M5 (AgentRuntime), M6 (AgentComm), M11 (TaskQueue)
M8 (SubGraph)         →  M4 (类型扩展), graphStore, Canvas
M9 (Group/Annotation) →  Canvas, ReactFlow 内置能力
M10 (SemanticIndex)   →  memory.py, sentence-transformers (新依赖)
M11 (TaskQueue)       →  无外部依赖（磁盘 JSON）
M12 (ResourceManager) →  M4 (类型扩展), .mag/assets/
M13 (Providers)       →  base.py (PlanProvider protocol)
M14 (MCPGateway)      →  M5 (AgentRuntime toolPolicy)
```

---

## 错误处理策略

| 场景 | 处理方式 |
|------|----------|
| **Provider API key 缺失** | 降级到离线 demo 模式，前端显示 "未配置 API Key" |
| **Provider 超时** | 30s 超时 → SSE error 事件 → 可重试 |
| **Claude Code 进程崩溃** | 捕获 exit code → SSE error + 进程树清理 |
| **Memory 文件写入失败** | 日志警告 → 不中断执行流 |
| **语义索引失败** | 回退到关键词搜索 → 不影响核心功能 |
| **Agent 消息投递失败** | 暂存 outbox → 下次轮询重试 |
| **任务队列文件损坏** | 备份旧文件 → 新队列从空开始 |
| **子图 JSON 解析失败** | 返回空图 + error 事件 |
| **并发写 .mag 文件** | 异步锁 (asyncio.Lock per project) |

---

## 配置项汇总

| 配置 | 位置 | 默认值 | 说明 |
|------|------|--------|------|
| `MAG_PORT` | env | 随机 | 后端端口 |
| `MAG_DEBUG` | env | 0 | 调试日志 |
| `ANTHROPIC_API_KEY` | env / localStorage | - | Claude API Key |
| `DEEPSEEK_API_KEY` | env / localStorage | - | DeepSeek API Key |
| `OPENAI_API_KEY` | env / localStorage | - | OpenAI API Key (new) |
| `GEMINI_API_KEY` | env / localStorage | - | Gemini API Key (new) |
| `MAG_AGENT_TIMEOUT` | env | 120s | Agent 执行超时 |
| `MAG_MAX_RETRIES` | env | 3 | 任务最大重试次数 |
| `MAG_EMBEDDING_MODEL` | env | all-MiniLM-L6-v2 | 语义索引模型 |
| `MAG_MEMORY_MAX_TOKENS` | env | 2000 | 记忆压缩阈值 |
