# 详细设计 — MindAgentGraph MVP

> 本文档把 `docs/high-level-design.md` 拆成可实现的模块设计。远期 Agent 编排、语义索引、MCP、完整资源管理不在本轮。

## M1：ProjectExplorer 左侧面板 `[modify]`

### 责任

把当前 `LeftPanel` 占位升级为真实项目浏览器：

- 节点树 Tab：按 DAG 入度和依赖关系展示节点层级。
- 文件范围 Tab：按节点展示 `fileScope.allow` / `fileScope.deny`。
- Agent Tab：筛选 `type === "agent"` 的节点，MVP 仅展示和选中，不执行独立运行时。

### 文件

- `frontend/src/components/LeftPanel.tsx` `[modify]`
- `frontend/src/components/ProjectExplorer.tsx` `[new]`
- `frontend/src/store/panelStore.ts` `[modify]`
- `frontend/src/store/graphStore.ts` `[modify if needed]`

### 接口

```typescript
type LeftTab = "nodes" | "files" | "agents";

interface ProjectTreeItem {
  id: string;
  title: string;
  type: NodeType;
  depth: number;
  hasCycle?: boolean;
}
```

### 树生成规则

1. 根据 `links` 统计入度和 children。
2. 入度为 0 的节点作为根节点。
3. DFS 展开 children，使用 `visitedPath` 标记循环，避免无限递归。
4. 无法从根访问的孤立/循环节点追加到列表尾部。
5. 点击节点调用 `selectNode(id)`，并在 UI 中高亮。

### 错误与空态

- 无节点：显示轻量空态。
- 存在循环：节点旁显示警告标记；DAG 执行也应阻止并记录错误。
- 节点缺少标题：回退显示 `Untitled`。

### 测试

- 树生成函数覆盖：单根、多根、孤立节点、循环。
- UI 手测：点击树节点后 Canvas/Inspector 同步选中。

## M2：BottomMonitor 底部监视器 `[modify]`

### 责任

把当前 `BottomPanel` 占位升级为执行可观测面板：

- Logs：规划、单节点执行、Code 执行、DAG 执行日志。
- Errors：错误摘要和关联节点。
- Tokens：按 Provider、模型、节点统计 usage。
- Progress：DAG 执行进度。

### 文件

- `frontend/src/components/BottomPanel.tsx` `[modify]`
- `frontend/src/components/BottomMonitor.tsx` `[new]`
- `frontend/src/store/monitorStore.ts` `[new]`
- `frontend/src/api/backend.ts` `[modify]`
- `frontend/src/hooks/useRunNode.ts` `[modify]`

### 数据结构

```typescript
interface MonitorLog {
  id: string;
  timestamp: number;
  level: "info" | "warn" | "error";
  source: "plan" | "node" | "code" | "dag" | "provider";
  nodeId?: string;
  nodeTitle?: string;
  message: string;
}

interface TokenUsage {
  id: string;
  timestamp: number;
  provider?: string;
  model?: string;
  nodeId?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

interface DagProgress {
  runId: string;
  nodeId: string;
  status: "pending" | "running" | "done" | "error" | "skipped";
  message?: string;
}
```

### SSE 事件

继续支持已有事件：

- `text`
- `files`
- `error`
- `done`

新增建议事件：

- `log`
- `usage`
- `progress`

Provider 无 usage 时不发送 `usage`，前端保持兼容。

### 测试

- `monitorStore` action 单元测试。
- 手测单节点成功、Provider 错误、Code 文件变更、DAG 中断。

## M3：共享数据模型扩展 `[modify]`

### 责任

补齐 MVP 需要的节点输出、运行历史和资源引用预留，同时保持旧项目可加载。

### 文件

- `shared/types.ts` `[modify]`
- `shared/schema/node.schema.json` `[modify]`
- `shared/schema/project.schema.json` `[modify if needed]`
- `backend/app/schemas.py` `[modify]`

### TypeScript

```typescript
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
}

export interface NodeBase {
  // existing fields...
  purpose?: string;
  output?: string;
  runHistory?: RunRecord[];
  resourceRefs?: string[];
  metadata?: Record<string, unknown>;
}

export interface Graph {
  nodes: NodeBase[];
  links: Edge[];
  metadata?: Record<string, unknown>;
}
```

### Python

```python
class RunRecord(BaseModel):
    id: str
    startedAt: str
    finishedAt: Optional[str] = None
    status: Literal["running", "done", "error", "cancelled"]
    provider: Optional[str] = None
    model: Optional[str] = None
    inputTokens: Optional[int] = None
    outputTokens: Optional[int] = None
    error: Optional[str] = None

class Node(BaseModel):
    # existing fields...
    purpose: Optional[str] = None
    output: Optional[str] = None
    runHistory: list[RunRecord] = Field(default_factory=list)
    resourceRefs: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
```

### 兼容性

- 所有新增字段都有默认值。
- 现有 `RunNodeInput` 保留 `purpose`，避免影响 `/run/node`。
- 序列化时允许保留空数组，方便 Git diff；也可在项目保存层过滤空字段。

## M4：DAG Executor `[new]`

### 责任

实现整图按依赖顺序执行，MVP 串行即可：

- 检测循环。
- 拓扑排序。
- 逐个执行节点。
- 通过 SSE 返回进度、日志、错误。
- 将父节点输出作为 `parentOutputs` 注入子节点。

### 文件

- `backend/app/services/dag_executor.py` `[new]`
- `backend/app/main.py` `[modify]`
- `frontend/src/api/backend.ts` `[modify]`
- `frontend/src/store/graphStore.ts` `[modify]`
- `frontend/src/store/monitorStore.ts` `[modify]`
- `frontend/src/components/Toolbar.tsx` `[modify]`

### 后端接口

```python
class RunDagRequest(BaseModel):
    graph: Graph
    projectPath: Optional[str] = None
    provider: Optional[Literal["anthropic", "deepseek"]] = None
    model: Optional[str] = None

@app.post("/run/dag")
async def run_dag(req: RunDagRequest) -> StreamingResponse:
    ...
```

### 拓扑排序

```python
def topological_sort(nodes: list[Node], links: list[Edge]) -> list[str]:
    # Kahn algorithm
    # if emitted count != node count -> cycle
```

### 执行策略

1. 对 Graph 做拓扑排序。
2. 每个节点开始前发送 `progress: running`。
3. 调用现有 `run_node_stream()`；Code 节点暂不自动批量执行，除非用户明确允许。
4. 聚合节点输出到 `results[node.id]`。
5. 成功发送 `progress: done`，失败发送 `progress: error` 并停止后续执行。

### MVP 决策

- Code 节点批量执行风险更高，默认在 DAG 中跳过并标记 `skipped`，除非请求参数显式允许。
- Agent 节点按普通 Prompt 节点执行，不启用独立 Agent runtime。
- 循环图直接拒绝执行，并在 BottomMonitor 显示错误。

## M5：Provider 与模型配置收敛 `[modify]`

### 责任

让 Provider 配置符合提案中的“基础 Provider 配置和模型切换”：

- 前端 Provider 选择与后端 schema 保持一致。
- 缺失 API Key 时给出明确 UI 错误。
- SSE 错误写入 BottomMonitor。
- 模型字段在日志和 runHistory 中留痕。

### 文件

- `frontend/src/store/providerStore.ts` `[modify]`
- `frontend/src/store/keyStore.ts` `[modify if needed]`
- `frontend/src/components/SettingsPanel.tsx` `[modify]`
- `backend/app/schemas.py` `[modify]`
- `backend/app/services/providers/base.py` `[modify if needed]`

### 验收

- Anthropic / DeepSeek 均可选择。
- 未配置 key 时，前端和日志能看到明确错误。
- 模型切换后的执行记录包含 provider/model。

## M6：FileScope 与上下文可视化 `[modify]`

### 责任

让用户能看出“AI 当前使用了什么上下文、文件范围和输出”：

- NodeInspector 展示上下文模式说明。
- FileScope allow/deny 可编辑且格式稳定。
- 执行前在 BottomMonitor 记录本次上下文摘要。
- Code 执行后展示文件变更事件。

### 文件

- `frontend/src/components/NodeInspector.tsx` `[modify]`
- `frontend/src/hooks/useRunNode.ts` `[modify]`
- `backend/app/services/runner.py` `[modify if needed]`
- `backend/app/services/code_runner.py` `[modify if needed]`

### 验收

- 用户可区分 `inherit`、`explicit`、`isolated` 的执行差异。
- Code 节点执行日志中包含 FileScope 摘要。
- 文件变更事件能关联回节点。

## M7：需求追踪文档 `[modify]`

### 责任

维护 `docs/requirements-traceability.md`，把提案 MVP 条目映射到代码模块和任务。

### 文件

- `docs/requirements-traceability.md` `[modify]`

### 字段

```markdown
| 需求 | MVP 状态 | 实现位置 | 任务文件 | 验收方式 |
```

状态使用：

- `done`
- `partial`
- `planned`
- `deferred`

## 质量门槛

每个实现批次完成后至少运行：

- `npm --prefix frontend run lint`
- `npm --prefix frontend run build`

后端改动后运行：

- `uv run pytest`，如果本地没有测试或 uv 环境不可用，记录未验证原因。

涉及 Tauri 项目 IO 后，补充桌面端手测：

- 打开项目。
- 保存项目。
- 重新加载 `.mag`。
