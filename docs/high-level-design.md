# 概要设计 — MindAgentGraph MVP

> 输入：`docs/proposal.md` 与当前代码库分析。目标：把产品提案收敛为当前仓库可执行的 MVP 架构。

## 1. MVP 架构目标

MindAgentGraph MVP 要验证一条闭环：

```text
用户目标
  -> Planning 节点生成 DAG
  -> 用户在画布调整节点与上下文
  -> 单节点或整图按依赖执行
  -> 输出、日志、记忆、文件范围回写到项目
```

当前实现已经具备画布、节点检查器、规划、单节点执行、Code 节点执行和 `.mag` 存储基础。本轮设计不重做架构，重点补齐可用性与可观测性。

## 2. 系统分层

```text
Tauri Shell
  ├─ React Frontend
  │   ├─ Workspace Layout
  │   ├─ Canvas / NodeInspector
  │   ├─ ProjectExplorer
  │   ├─ BottomMonitor
  │   └─ Zustand Stores + API Client
  ├─ Rust Project IO / Sidecar Manager
  └─ FastAPI Backend
      ├─ Planner
      ├─ Node Runner
      ├─ Code Runner
      ├─ DAG Executor
      ├─ Memory Service
      └─ Provider Layer
```

## 3. 模块划分

### 3.1 Frontend

| 模块 | 当前状态 | MVP 职责 |
|------|----------|----------|
| Canvas | 已有 | 渲染 DAG、拖拽节点、连线、删除、选中 |
| NodeInspector | 已有 | 编辑节点目标、Prompt、Memory、FileScope、ContextMode、执行输出 |
| PlanInput | 已有 | 输入项目目标并生成节点图 |
| Toolbar | 已有 | 打开/保存、添加节点、运行、设置、面板切换 |
| LeftPanel / ProjectExplorer | 外壳已有 | 节点树、文件范围摘要、Agent 类型节点列表 |
| BottomPanel / BottomMonitor | 外壳已有 | AI 日志、错误反馈、Token 使用、执行队列状态 |
| graphStore | 已有 | 图状态、选中状态、项目路径 |
| monitorStore | 新增 | 日志、Token、DAG 执行进度 |
| panelStore | 已有 | 面板开关、尺寸、活动 Tab |

### 3.2 Backend

| 模块 | 当前状态 | MVP 职责 |
|------|----------|----------|
| Planner | 已有 | 用户目标生成 Graph |
| Runner | 已有 | 单节点文本执行，组装节点上下文 |
| CodeRunner | 已有 | Code 节点调用 CLI，注入 FileScope |
| Memory | 已有 | `.mag/memory/` Markdown 读写 |
| Provider | 已有 | Anthropic、DeepSeek 适配 |
| DAG Executor | 新增/收敛 | 按拓扑顺序执行节点，发出 SSE 进度 |
| Usage Normalizer | 新增 | 统一 Provider Token/模型信息，写入监控事件 |

### 3.3 Shared / Storage

| 模块 | 当前状态 | MVP 职责 |
|------|----------|----------|
| `shared/types.ts` | 已有 | 前端图与节点类型 |
| `backend/app/schemas.py` | 已有 | 后端请求/响应模型 |
| `.mag/project.json` | 已有方向 | 项目元数据 |
| `.mag/graphs/*.json` | 已有方向 | DAG 图结构 |
| `.mag/memory/*.md` | 已有 | 节点记忆 |
| `.mag/logs/*.jsonl` | 新增建议 | 执行日志与错误记录，可选落盘 |

## 4. 关键数据流

### 4.1 规划流

```text
PlanInput
  -> POST /plan
  -> Planner
  -> Provider.plan_graph()
  -> Graph
  -> graphStore.setGraph()
  -> Canvas + ProjectExplorer
```

要求：

- Provider 返回内容必须被校验为 `Graph`。
- 规划失败时写入 BottomMonitor 日志。
- 生成节点必须包含 `purpose`/`systemPrompt`/`fileScope` 的最小可编辑字段。

### 4.2 单节点执行流

```text
NodeInspector
  -> POST /run/node or /run/node/code
  -> Runner / CodeRunner
  -> Memory + parentOutputs + node fields
  -> Provider / CLI
  -> SSE text/error/files/usage/done
  -> Node output + BottomMonitor
```

要求：

- `inherit` 模式读取 Memory 和上游输出。
- `explicit` 模式只使用当前节点显式字段和用户输入。
- `isolated` 模式不读取/写入 Memory。
- Code 节点必须展示本次 FileScope 注入内容和文件变更。

### 4.3 DAG 执行流

```text
Toolbar Run DAG
  -> POST /run/dag
  -> DAG Executor
  -> topological sort
  -> execute nodes sequentially
  -> SSE progress/log/error/done
  -> graphStore node outputs + monitorStore
```

MVP 只要求按依赖顺序串行执行。并行执行、Agent 调度、任务队列持久化放到后续阶段。

## 5. 数据模型扩展

MVP 扩展必须向后兼容。建议在 `NodeBase` / `Node` 中增加可选字段：

```typescript
interface NodeBase {
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

  purpose?: string;
  output?: string;
  runHistory?: RunRecord[];
  resourceRefs?: string[];
  metadata?: Record<string, unknown>;
}
```

`Graph` 建议增加：

```typescript
interface Graph {
  nodes: NodeBase[];
  links: Edge[];
  metadata?: Record<string, unknown>;
}
```

远期的 `groups`、`subGraphs`、`annotations`、`semanticIndex` 不进入本轮 MVP 数据迁移，避免提前锁死模型。

## 6. UI 布局

采用当前 4 区布局继续演进：

```text
┌──────────────┬─────────────────────────┬────────────────┐
│ Project      │ Toolbar + PlanInput      │ NodeInspector  │
│ Explorer     │ Canvas                   │                │
├──────────────┴─────────────────────────┴────────────────┤
│ BottomMonitor: logs / errors / tokens / DAG progress      │
└───────────────────────────────────────────────────────────┘
```

设计原则：

- 工作台信息密度优先，避免营销式页面。
- 节点树、画布、检查器之间必须联动选中状态。
- 底部监视器必须直接呈现执行状态，不用弹窗承载主要反馈。
- 面板折叠后仍保留清晰的恢复入口。

## 7. 阶段边界

### 当前 MVP 收尾

- ProjectExplorer：节点树、文件范围摘要、Agent 列表。
- BottomMonitor：日志、错误、Token、DAG 进度。
- 数据模型：节点输出、运行历史、资源引用预留。
- DAG Executor：顺序拓扑执行与进度事件。
- Provider/模型配置：统一选择、错误展示、usage 事件。

### 后续阶段

- AgentRuntime、AgentComm、Supervisor。
- SubGraph、分组、注释、节点模板。
- 多模态资源管理器。
- 语义索引和自动上下文压缩。
- MCP 工具网关。
- Unreal / Houdini / PCG 深度集成。

## 8. 兼容性策略

- 新字段一律可选，缺失时保持当前行为。
- `.mag` 旧项目加载时不做强制迁移，只在保存时补全必要字段。
- 后端 Pydantic schema 使用默认工厂避免空字段报错。
- 前端组件对 `output`、`runHistory`、`resourceRefs` 均做空值处理。
- Provider usage 不可用时，BottomMonitor 显示“未提供”，不阻断执行。
