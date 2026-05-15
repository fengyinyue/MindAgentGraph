# 概要设计文档 — MindAgentGraph

## 1. 整体架构概览

```
┌─────────────────────────────────────────────────────────────────┐
│                        Tauri 2.x Shell                          │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                   React Frontend (Vite)                     │  │
│  │  ┌─────────┐  ┌──────────────┐  ┌────────────────────────┐ │  │
│  │  │ 左侧面板 │  │   中间画布     │  │      右侧面板          │ │  │
│  │  │ 项目树   │  │  ReactFlow   │  │   NodeInspector       │ │  │
│  │  │ Agent列表│  │  无限画布     │  │   Memory/Prompt编辑    │ │  │
│  │  └─────────┘  └──────────────┘  └────────────────────────┘ │  │
│  │  ┌──────────────────────────────────────────────────────────┐ │  │
│  │  │                    底部面板                               │ │  │
│  │  │          AI日志  │  Agent通信  │  Token使用              │ │  │
│  │  └──────────────────────────────────────────────────────────┘ │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌──────────────────────┐  ┌──────────────────────────────────┐  │
│  │   Tauri Rust Layer   │  │   FastAPI Backend (Sidecar)       │  │
│  │   - 文件对话框        │  │   - REST API + SSE                │  │
│  │   - .mag 读写         │  │   - AI Provider 抽象层            │  │
│  │   - 进程管理          │  │   - Agent 运行时                   │  │
│  └──────────────────────┘  │   - Memory 服务                    │  │
│                              │   - 任务队列                      │  │
│                              └──────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

**架构风格：** 分层 + 插件式
- 前端：UI 面板层 → 状态管理层 → API 通信层
- 后端：REST/SSE 接口层 → 业务服务层 → Provider 抽象层 → 外部 AI SDK
- 存储：.mag 文件夹（JSON + Markdown + 资源文件），Git 友好

---

## 2. 模块划分

### 2.1 前端模块

| 模块 | 状态 | 职责 |
|------|------|------|
| **Canvas (画布)** | ✅ 已有 | ReactFlow 节点图渲染、拖拽、缩放、连线、右键菜单、键盘快捷键 |
| **NodeInspector (节点检查器)** | ✅ 已有 | 右侧面板：节点属性编辑、Purpose、SystemPrompt、MemoryRef、FileScope、执行输出 |
| **PlanInput (规划输入)** | ✅ 已有 | 顶部输入栏：Provider 选择 + 目标输入 + 一键生成节点树 |
| **Toolbar (工具栏)** | ✅ 已有 | 打开/保存/添加节点/运行DAG/项目目录/设置 |
| **SettingsPanel (设置面板)** | ✅ 已有 | API Key 管理（Anthropic、DeepSeek），localStorage 持久化 |
| **ProjectExplorer (项目浏览器)** | 🆕 新增 | 左侧面板：节点树形列表、项目文件结构、Agent 列表 |
| **BottomMonitor (底部监视器)** | 🆕 新增 | AI 日志流、Agent 间通信记录、Token 消耗统计 |
| **SubGraphEditor (子图编辑器)** | 🆕 新增 | 双击 SubGraph 节点进入嵌套画布，支持面包屑导航 |
| **ResourcePanel (资源面板)** | 🆕 新增 | 多模态资源绑定界面：图片/视频/音频/3D/文档上传与预览 |
| **AgentComposer (Agent 编排器)** | 🆕 新增 | Agent 节点消息流可视化、任务分发配置 |

### 2.2 后端模块

| 模块 | 状态 | 职责 |
|------|------|------|
| **Planner (规划服务)** | ✅ 已有 | 一句话目标 → LLM 生成 DAG 节点树，支持 tool_use / json_object 模式 |
| **Runner (节点执行服务)** | ✅ 已有 | 单节点 AI 文本展开，SSE 流式输出，上下文组装（inherit/explicit/isolated） |
| **CodeRunner (代码执行服务)** | ✅ 已有 | Claude Code CLI 子进程调用，fileScope 约束注入，进程树管理 |
| **Memory (记忆服务)** | ✅ 已有 | .mag/memory/ 文件读写，路径安全校验，防穿越攻击 |
| **Provider (AI 抽象层)** | ✅ 已有 | Protocol 模式：Anthropic SDK + DeepSeek (OpenAI SDK)，统一错误处理 |
| **AgentRuntime (Agent 运行时)** | 🆕 新增 | Agent 节点专用执行器：生命周期管理（spawn/monitor/terminate）、独立上下文沙箱 |
| **AgentComm (Agent 通信)** | 🆕 新增 | Agent 间消息传递协议、Supervisor 任务分发、结果聚合与冲突解决 |
| **TaskQueue (任务队列)** | 🆕 新增 | 持久化任务队列：排队、重试、暂停/恢复、优先级调度 |
| **MCPGateway (MCP 网关)** | 🆕 新增 | Model Context Protocol 服务端，工具注册与发现，权限控制 |
| **ResourceManager (资源管理)** | 🆕 新增 | 多模态资源 CRUD、缩略图生成、与 .mag/assets/ 的读写 |
| **OpenAIProvider (OpenAI 适配器)** | 🆕 新增 | OpenAI SDK 适配，复用现有 Provider protocol |
| **GeminiProvider (Gemini 适配器)** | 🆕 新增 | Google Gemini SDK 适配 |
| **SemanticIndex (语义索引)** | 🆕 新增 | 长期记忆的向量索引、语义搜索、自动压缩 |

### 2.3 存储层

| 模块 | 状态 | 职责 |
|------|------|------|
| **ProjectStorage (.mag)** | ✅ 已有 | project.json + graphs/*.json + memory/*.md + assets/ 文件夹结构 |
| **GraphSerializer (图序列化)** | ✅ 已有 | 节点/边 ↔ JSON 双向转换，ReactFlow ↔ Zustand ↔ .mag |
| **MemoryIndex (记忆索引)** | 🆕 新增 | .mag/memory/ 的全文搜索索引，支持语义相似度检索 |
| **AssetStore (资源存储)** | 🆕 新增 | .mag/assets/ 的文件管理，引用计数，去重 |

### 2.4 Tauri Rust Layer

| 模块 | 状态 | 职责 |
|------|------|------|
| **Sidecar (进程管理)** | ✅ 已有 | 后端 FastAPI 进程生命周期，端口协商 |
| **FileDialog (文件对话框)** | ✅ 已有 | 原生打开/保存文件夹对话框 |
| **ProjectIO (项目 IO)** | ✅ 已有 | .mag 文件夹读写（Rust 侧） |
| **Clipboard (剪贴板)** | 🆕 新增 | 节点复制粘贴的跨画布数据交换 |

---

## 3. 模块间关系

```
┌──────────────────────────────────────────────────────────────────┐
│                         FRONTEND                                  │
│                                                                    │
│  ProjectExplorer ──▶ graphStore ◀── Canvas                        │
│        │                  │              │                          │
│        │             Zustand           NodeInspector               │
│        │                  │              │                          │
│        └──────────────────┼──────────────┘                          │
│                           │                                         │
│                    API Layer (api/)                                 │
│                           │                                         │
├───────────────────────────┼───────────────────────────────────────┤
│                      HTTP / SSE                                     │
├───────────────────────────┼───────────────────────────────────────┤
│                         BACKEND                                     │
│                           │                                         │
│                    ┌──────┴──────┐                                  │
│                    │   REST API   │                                  │
│                    └──────┬──────┘                                  │
│           ┌───────────────┼───────────────┐                         │
│     ┌─────┴─────┐  ┌──────┴──────┐  ┌─────┴─────┐                  │
│     │  Planner   │  │   Runner    │  │ AgentRuntime│                │
│     └─────┬─────┘  └──────┬──────┘  └─────┬─────┘                  │
│           │               │               │                         │
│     ┌─────┴───────────────┴───────────────┴─────┐                  │
│     │            Provider Layer                  │                  │
│     │  ┌──────────┐ ┌────────┐ ┌────┐ ┌──────┐ │                  │
│     │  │Anthropic │ │DeepSeek│ │GPT │ │Gemini│ │                  │
│     │  └──────────┘ └────────┘ └────┘ └──────┘ │                  │
│     └───────────────────────────────────────────┘                  │
│                           │                                         │
│     ┌─────────────────────┼─────────────────────┐                  │
│     │               Service Layer                │                  │
│     │  ┌──────┐ ┌──────────┐ ┌───────────────┐  │                  │
│     │  │Memory│ │TaskQueue │ │MCPGateway     │  │                  │
│     │  └──────┘ └──────────┘ └───────────────┘  │                  │
│     │  ┌──────────────┐ ┌────────────────────┐  │                  │
│     │  │ResourceManager│ │SemanticIndex      │  │                  │
│     │  └──────────────┘ └────────────────────┘  │                  │
│     └────────────────────────────────────────────┘                  │
│                           │                                         │
│                    ┌──────┴──────┐                                  │
│                    │  .mag 存储   │                                  │
│                    └─────────────┘                                  │
└──────────────────────────────────────────────────────────────────┘
```

**数据流关键路径：**

1. **规划流（Plan Flow）：**
   用户输入目标 → PlanInput → `/plan` → Planner → LLM Provider → 返回 Graph → graphStore → Canvas 渲染

2. **执行流（Execute Flow）：**
   用户点击执行 → NodeInspector → `/run/node` → Runner → 组装上下文（Memory + fileScope + parentOutputs） → LLM Provider → SSE 流式返回 → NodeInspector 实时显示

3. **Agent 协作流（Agent Flow，新增）：**
   Supervisor 分解任务 → AgentRuntime 分配 → 各 Agent 节点并行执行 → AgentComm 消息通信 → 结果聚合 → 回写 Memory

4. **代码生成流（Code Flow）：**
   用户触发 Code → `/run/node/code` → CodeRunner → 注入 node 上下文到 Claude Code CLI → 子进程执行 → SSE 流式返回 + 文件变更检测

---

## 4. 技术选型

| 层面 | 技术 | 说明 |
|------|------|------|
| **桌面壳** | Tauri 2.x (Rust) | 已有，轻量跨平台桌面壳 |
| **前端框架** | React 18 + TypeScript | 已有 |
| **构建工具** | Vite | 已有 |
| **节点画布** | @xyflow/react v12 (ReactFlow) | 已有 |
| **状态管理** | Zustand v5 | 已有，分 store 管理 |
| **样式** | Tailwind CSS 3 | 已有，暗色科技风主题 |
| **后端框架** | Python FastAPI | 已有，REST + SSE |
| **AI SDK** | Anthropic SDK + OpenAI SDK | 已有，Provider protocol 模式 |
| **包管理** | uv (Python) + npm (Node) | 已有 |
| **存储格式** | .mag 文件夹（JSON + MD + 资源） | 已有，Git 友好 |
| **进程通信** | HTTP/SSE + stdin/stdout | 已有，前后端用 SSE 流式 |
| **向量检索** | SQLite + sqlite-vec 或 ChromaDB | 语义索引新增依赖 |
| **任务队列** | 内存队列 + JSON 文件持久化 | 轻量方案，无需 Redis |

---

## 5. 关键设计决策

### 5.1 前端面板布局演进

当前是 2 列布局（Canvas + NodeInspector），目标 4 区布局：

- **左侧面板（新增）：** 可折叠，320px 宽，包含项目树 + Agent 列表两个 Tab
- **中间画布（已有）：** 保持 ReactFlow，新增 SubGraph 双击进入嵌套
- **右侧面板（已有）：** 扩展 NodeInspector，增加 Resource 绑定 Tab
- **底部面板（新增）：** 可折叠，200px 高，包含 AI 日志 + Agent 通信 + Token 统计三个 Tab

采用 CSS Grid 响应式布局，所有面板均可拖拽调整大小（react-resizable-panels）。

### 5.2 Agent 运行时架构

```
AgentRuntime
  ├── AgentSupervisor (总控)
  │     - 读取 DAG 结构
  │     - 分解任务
  │     - 调度 Agent 节点
  │     - 聚合结果
  ├── AgentWorker (工作 Agent)
  │     - 独立上下文沙箱
  │     - 独立 Memory 空间
  │     - 独立 fileScope
  │     - 工具权限控制
  └── AgentMailbox (消息通信)
        - 点对点消息
        - 广播消息
        - 消息持久化
```

### 5.3 子图（SubGraph）设计

- SubGraph 节点在父图中表现为一个节点
- 双击 SubGraph 节点进入子图画布
- 子图可以有输入/输出端口（暴露给父图连线）
- 面包屑导航：`主图 > RoadSystem > LaneGenerator`
- 存储：子图保存为 `graphs/<subgraph-id>.json`

### 5.4 语义索引

- 对所有 .mag/memory/*.md 文件建立向量索引
- 使用本地 embedding 模型（如 sentence-transformers）
- 支持语义搜索：找到"和这个节点最相关的历史记忆"
- 自动压缩：当记忆超过阈值时，自动生成摘要替换原文

### 5.5 MCP 工具系统

- 后端实现 MCP Server（stdio 或 HTTP 传输）
- 每个 Agent 节点可配置其可用的 MCP 工具列表
- 工具注册表：MCPGateway 维护全局工具目录
- 权限控制：node.toolPolicy 控制每个节点的工具白名单/黑名单

---

## 6. 开发阶段划分

### Phase 1（当前 MVP 完善）— 已完成约 80%

- [x] 节点 CRUD + 连线 + 拖拽
- [x] AI 规划（一句话 → 节点树）
- [x] 节点执行（Explain + Code）
- [x] Memory 读写 + 路径安全
- [x] .mag 存储
- [x] Anthropic / DeepSeek 双 Provider
- [ ] **左侧面板：项目树 + Agent 列表**（Phase 1 收尾）
- [ ] **底部面板：AI 日志 + Token 统计**（Phase 1 收尾）

### Phase 2（Agent 系统）— 核心差异化

- [ ] AgentRuntime 运行时
- [ ] Agent 通信协议
- [ ] Supervisor 调度器
- [ ] 多 Agent 协作流程

### Phase 3（高级节点能力）

- [ ] SubGraph 子图系统
- [ ] 节点分组 + 折叠
- [ ] 节点注释（便签）
- [ ] 语义地图

### Phase 4（生态扩展）

- [ ] 多模态资源管理
- [ ] OpenAI / Gemini Provider
- [ ] MCP 工具系统
- [ ] 任务队列持久化

### Phase 5（游戏引擎连接器）

- [ ] UE Blueprint 自动生成
- [ ] PCG Graph 生成
- [ ] Behavior Tree 生成
- [ ] Git 仓库理解

---

## 7. 与现有代码的兼容性

| 现有模块 | 变更策略 |
|----------|----------|
| **graphStore.ts** | 扩展：增加 subGraphs 状态、groups 状态、annotations 状态 |
| **NodeBase 类型** | 扩展：增加 groupId、isCollapsed、subGraphRef 等可选字段 |
| **Canvas.tsx** | 扩展：增加 SubGraph 双击处理、分组框选、折叠动画 |
| **App.tsx** | 重构：从 2 列布局改为 4 区 Grid 布局 |
| **schemas.py** | 扩展：对应前端的 NodeBase 扩展字段 |
| **main.py** | 扩展：新增 Agent、SubGraph、MCP 相关路由 |
| **runner.py** | 扩展：Agent 执行模式（并行、带消息通信） |
| **memory.py** | 扩展：语义索引、全文搜索 |

**向后兼容：** 所有新增字段均为可选（Optional），默认值保持当前行为不变。已有 .mag 文件可正常打开。
